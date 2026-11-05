import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecClient } from '../src/modules/sec/sec.client';
import { ProxyAgent } from 'undici';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const url = 'https://www.sec.gov/files/company_tickers.json';
const config = (extra = {}) =>
  new ConfigService({
    SEC_USER_AGENT: 'test-suite test@example.com',
    ...extra,
  });

describe('SecClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('routes SEC requests through the configured proxy and closes it on shutdown', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const client = new SecClient(
      config({ SEC_PROXY_URL: 'http://127.0.0.1:7897' }),
    );
    await client.getJson(url);
    expect(ProxyAgent).toHaveBeenCalledWith('http://127.0.0.1:7897');
    const options = fetchMock.mock.calls[0][1] as RequestInit & {
      dispatcher: ProxyAgent;
    };
    expect(options.dispatcher).toBeDefined();
    await client.onModuleDestroy();
    expect(options.dispatcher.close).toHaveBeenCalledTimes(1);
  });
  it('does not supply a proxy dispatcher when the proxy is not configured', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    await new SecClient(config({ SEC_PROXY_URL: '' })).getJson(url);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('dispatcher');
    expect(ProxyAgent).not.toHaveBeenCalled();
  });
  it.each(['not-a-url', 'socks5://127.0.0.1:7897'])(
    'rejects an unsupported proxy URL %s',
    (proxy) => {
      expect(() => new SecClient(config({ SEC_PROXY_URL: proxy }))).toThrow(
        'SEC_PROXY_URL',
      );
    },
  );
  it('streams ZIP bytes to disk instead of decoding the download as JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sec-download-test-'));
    const path = join(directory, 'test.zip');
    const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 255]);
    fetchMock.mockResolvedValue(new Response(bytes));
    const client = new SecClient(config());
    try {
      await client.downloadFile(url, path, 1000);
      expect(await readFile(path)).toEqual(bytes);
      expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
        expect.objectContaining({ Accept: 'application/zip' }),
      );
    } finally {
      await client.onModuleDestroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('requires contact information', () => {
    expect(() => new SecClient(new ConfigService({}))).toThrow(
      'SEC_USER_AGENT',
    );
    expect(() => new SecClient(config({ SEC_USER_AGENT: 'no-email' }))).toThrow(
      'SEC_USER_AGENT',
    );
  });
  it.each(['0', '-1', 'NaN', '60001'])(
    'rejects invalid timeout %s',
    (value) => {
      expect(() => new SecClient(config({ SEC_TIMEOUT_MS: value }))).toThrow(
        'SEC_TIMEOUT_MS',
      );
    },
  );
  it('sends identifying headers and a timeout signal', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));
    await expect(new SecClient(config()).getJson(url)).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: {
          'User-Agent': 'test-suite test@example.com',
          Accept: 'application/json',
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([404, 500])(
    'maps SEC HTTP %s to 502, not a company 404',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('', { status }));
      await expect(new SecClient(config()).getJson(url)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    },
  );
  it('maps access denial to 503', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    await expect(new SecClient(config()).getJson(url)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('observes 429 cooldown without making another network call', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
    );
    const client = new SecClient(config());
    await expect(client.getJson(url)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(client.getJson(url)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('maps invalid JSON to 502', async () => {
    fetchMock.mockResolvedValue(new Response('<html>error</html>'));
    await expect(new SecClient(config()).getJson(url)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('maps network errors to 502', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));
    await expect(new SecClient(config()).getJson(url)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it.each([
    'ENOTFOUND',
    'ECONNRESET',
    'ETIMEDOUT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ])('exposes diagnostic code %s without raw errors', async (code) => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed: private details', {
        cause: Object.assign(new Error('private details'), { code }),
      }),
    );
    const error = await new SecClient(config())
      .getJson(url)
      .catch((error: BadGatewayException) => error);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getResponse()).toEqual(
      expect.objectContaining({ statusCode: 502, code }),
    );
    expect(
      JSON.stringify((error as BadGatewayException).getResponse()),
    ).not.toContain('private details');
  });
  it('extracts connection errors nested in AggregateError', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed', {
        cause: new AggregateError([
          Object.assign(new Error(), { code: 'ETIMEDOUT' }),
        ]),
      }),
    );
    const error = await new SecClient(config())
      .getJson(url)
      .catch((error: BadGatewayException) => error);
    expect((error as BadGatewayException).getResponse()).toEqual(
      expect.objectContaining({ code: 'ETIMEDOUT' }),
    );
  });
  it('distinguishes invalid JSON from connection failures', async () => {
    fetchMock.mockResolvedValue(new Response('<html>blocked</html>'));
    const error = await new SecClient(config())
      .getJson(url)
      .catch((error: BadGatewayException) => error);
    expect((error as BadGatewayException).getResponse()).toEqual(
      expect.objectContaining({ code: 'SEC_INVALID_JSON' }),
    );
  });
  it('aborts slow requests with 504', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    );
    await expect(
      new SecClient(config({ SEC_TIMEOUT_MS: '10' })).getJson(url),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });
  it('spaces concurrent requests at least 200ms apart and recovers after failures', async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(performance.now());
      if (times.length === 1) throw new Error('temporary failure');
      return new Response('{}');
    });
    const client = new SecClient(config());
    const results = await Promise.allSettled([
      client.getJson(url),
      client.getJson(url),
      client.getJson(url),
    ]);
    expect(results.map((x) => x.status)).toEqual([
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(200);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(200);
  });
});
