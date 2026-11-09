import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { isNativeError } from 'node:util/types';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ProxyAgent } from 'undici';

@Injectable()
export class SecClient implements OnModuleDestroy {
  private readonly proxyAgent?: ProxyAgent;
  private readonly logger = new Logger(SecClient.name);
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private pending = 0;

  constructor(config: ConfigService) {
    this.userAgent = config.get<string>('SEC_USER_AGENT')?.trim() ?? '';
    if (
      !/^[\x20-\x7E]+$/.test(this.userAgent) ||
      !/^.+\s+[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.userAgent)
    ) {
      throw new Error(
        'SEC_USER_AGENT must include an application name and contact email',
      );
    }
    this.timeoutMs = Number(config.get('SEC_TIMEOUT_MS') ?? 15000);
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 60000
    ) {
      throw new Error('SEC_TIMEOUT_MS must be an integer between 1 and 60000');
    }
    const proxyUrl = config.get<string>('SEC_PROXY_URL')?.trim();
    if (proxyUrl) {
      let parsed: URL;
      try {
        parsed = new URL(proxyUrl);
      } catch {
        throw new Error(
          'SEC_PROXY_URL must be a valid HTTP or HTTPS proxy URL',
        );
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('SEC_PROXY_URL must use HTTP or HTTPS');
      }
      this.proxyAgent = new ProxyAgent(proxyUrl);
      this.logger.log('SEC HTTP proxy enabled');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.proxyAgent?.close();
  }

  getJson(url: string): Promise<unknown> {
    return this.enqueue(() => this.request(url));
  }

  getText(url: string): Promise<string> {
    return this.enqueue(() =>
      this.request(url, undefined, undefined, true),
    ) as Promise<string>;
  }

  async downloadFile(
    url: string,
    destination: string,
    timeoutMs = 1800000,
  ): Promise<void> {
    await this.enqueue(() => this.request(url, destination, timeoutMs));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.pending >= 100)
      return Promise.reject(
        new ServiceUnavailableException('SEC request queue is full'),
      );
    this.pending++;
    const result = this.queue.then(task);
    // A failed request must not prevent later queued requests from running.
    this.queue = result.catch(() => undefined);
    return result.finally(() => {
      this.pending--;
    });
  }

  private async request(
    url: string,
    destination?: string,
    downloadTimeout = 1800000,
    asText = false,
  ): Promise<unknown> {
    if (Date.now() < this.cooldownUntil)
      throw new ServiceUnavailableException(
        'SEC rate limit cooldown; retry later',
      );
    while (performance.now() < this.nextRequestAt) {
      await delay(Math.max(1, this.nextRequestAt - performance.now()));
    }
    const signal = AbortSignal.timeout(
      destination ? downloadTimeout : this.timeoutMs,
    );
    try {
      const options: RequestInit & { dispatcher?: ProxyAgent } = {
        headers: {
          'User-Agent': this.userAgent,
          Accept: asText
            ? 'text/html'
            : destination
              ? 'application/zip'
              : 'application/json',
        },
        signal,
        redirect: 'error',
        ...(this.proxyAgent ? { dispatcher: this.proxyAgent } : {}),
      };
      // Schedule from actual dispatch with a small safety margin; wall-clock changes cannot shorten the interval.
      this.nextRequestAt = performance.now() + 210;
      const response = await fetch(url, options);
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = retry ? Number(retry) : NaN;
          const until =
            retry && !Number.isFinite(seconds)
              ? Date.parse(retry)
              : Date.now() + seconds * 1000;
          this.cooldownUntil = Math.max(
            Date.now() + 60000,
            Number.isFinite(until) ? until : 0,
          );
          throw new ServiceUnavailableException(
            'SEC rate limit reached; retry later',
          );
        }
        if (response.status === 403)
          throw new ServiceUnavailableException(
            'SEC denied access; check contact configuration or retry later',
          );
        // Only a missing ticker in the mapping is a client-facing 404.
        throw new BadGatewayException(`SEC returned HTTP ${response.status}`);
      }
      if (destination) {
        if (!response.body)
          throw new BadGatewayException('SEC returned an empty download');
        await pipeline(
          Readable.fromWeb(
            response.body as import('node:stream/web').ReadableStream<Uint8Array>,
          ),
          createWriteStream(destination, { flags: 'wx' }),
          { signal },
        );
        return;
      }
      if (asText) {
        const reader = response.body?.getReader();
        if (!reader) throw new BadGatewayException('SEC returned empty HTML');
        const parts: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20_000_000) {
            await reader.cancel();
            throw new BadGatewayException('SEC HTML exceeds 20 MB limit');
          }
          parts.push(value);
        }
        return Buffer.concat(parts).toString('utf8');
      }
      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (signal.aborted)
        throw new GatewayTimeoutException('SEC request timed out');
      if (isNativeError(error) && error.name === 'SyntaxError') {
        this.logger.error(
          `SEC returned invalid JSON: ${new URL(url).hostname}`,
        );
        throw new BadGatewayException({
          statusCode: 502,
          error: 'Bad Gateway',
          code: 'SEC_INVALID_JSON',
          message: 'SEC returned invalid JSON instead of company data',
        });
      }
      const network = this.networkFailure(error);
      this.logger.error(
        `SEC request failed: ${new URL(url).hostname} [${network.code}]`,
      );
      throw new BadGatewayException({
        statusCode: 502,
        error: 'Bad Gateway',
        ...network,
      });
    }
  }

  private networkFailure(error: unknown): { code: string; message: string } {
    const reasons: Record<string, string> = {
      ENOTFOUND:
        'SEC hostname could not be resolved; check DNS and network access',
      EAI_AGAIN: 'SEC DNS lookup temporarily failed; check DNS or retry later',
      ECONNRESET: 'SEC connection was reset; check network or proxy settings',
      ECONNREFUSED:
        'SEC connection was refused; check network or proxy settings',
      ENETUNREACH: 'SEC network is unreachable; check network access',
      ETIMEDOUT: 'Connection to SEC timed out; check network or proxy settings',
      UND_ERR_CONNECT_TIMEOUT:
        'Connection to SEC timed out; check network or proxy settings',
      CERT_HAS_EXPIRED:
        'SEC TLS certificate validation failed; check system clock and certificate configuration',
      DEPTH_ZERO_SELF_SIGNED_CERT:
        'SEC TLS certificate validation failed; check trusted certificates',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE:
        'SEC TLS certificate validation failed; check trusted certificates',
    };
    const find = (value: unknown, depth = 0): string | undefined => {
      if (depth > 4 || typeof value !== 'object' || value === null) return;
      const detail = value as {
        code?: unknown;
        cause?: unknown;
        errors?: unknown[];
      };
      if (
        typeof detail.code === 'string' &&
        Object.hasOwn(reasons, detail.code)
      )
        return detail.code;
      const cause = find(detail.cause, depth + 1);
      if (cause) return cause;
      if (Array.isArray(detail.errors)) {
        for (const nested of detail.errors) {
          const code = find(nested, depth + 1);
          if (code) return code;
        }
      }
    };
    const code = find(error);
    return code
      ? { code, message: reasons[code] }
      : {
          code: 'SEC_NETWORK_ERROR',
          message: 'SEC connection failed; check server network access',
        };
  }
}
