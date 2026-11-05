import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { SecClient } from '../src/modules/sec/sec.client';
import { normalizeCik, SecService } from '../src/modules/sec/sec.service';

const mapping = {
  '0': { ticker: 'GOOG', cik_str: 1652044, title: 'Unused mapping title' },
  '1': { ticker: 'GOOGL', cik_str: 1652044 },
  '2': { ticker: 'AAPL', cik_str: 320193 },
};
// Deliberately synthetic fixtures: tests never depend on changing SEC data.
const submission = {
  cik: '1652044',
  name: 'Fixture Company',
  sic: '7370',
  sicDescription: 'Fixture Industry',
  fiscalYearEnd: '1231',
  filings: { recent: { form: ['10-K'] } },
};

describe('SEC mapping and cache', () => {
  let getJson: jest.Mock;
  let service: SecService;
  beforeEach(() => {
    getJson = jest
      .fn()
      .mockResolvedValueOnce(mapping)
      .mockResolvedValue(submission);
    service = new SecService({ getJson } as unknown as SecClient);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [1652044, '0001652044'],
    ['0000320193', '0000320193'],
  ])('pads CIK %s', (input, expected) => {
    expect(normalizeCik(input)).toBe(expected);
  });
  it.each([undefined, null, 'x', 0, -1, '12345678901'])(
    'rejects invalid CIK %s',
    (input) => {
      expect(() => normalizeCik(input)).toThrow(BadGatewayException);
    },
  );
  it('returns paginated SEC ticker data without requesting submissions', async () => {
    await expect(service.getCompanies(1, 2)).resolves.toEqual({
      source: 'SEC',
      total: 3,
      page: 1,
      limit: 2,
      data: [
        { ticker: 'GOOG', cik: '0001652044', name: 'Unused mapping title' },
        { ticker: 'GOOGL', cik: '0001652044', name: null },
      ],
    });
    const next = await service.getCompanies(2, 2);
    expect(next.data).toEqual([
      { ticker: 'AAPL', cik: '0000320193', name: null },
    ]);
    expect((await service.getCompanies(3, 2)).data).toEqual([]);
    expect(getJson).toHaveBeenCalledTimes(1);
    expect(getJson).toHaveBeenCalledWith(
      'https://www.sec.gov/files/company_tickers.json',
    );
  });
  it('maps only the public response fields and uses a padded URL', async () => {
    await expect(service.getCompany('GOOG')).resolves.toEqual({
      ticker: 'GOOG',
      cik: '0001652044',
      name: 'Fixture Company',
      sic: '7370',
      industry: 'Fixture Industry',
      fiscalYearEnd: '1231',
    });
    expect(getJson).toHaveBeenLastCalledWith(
      'https://data.sec.gov/submissions/CIK0001652044.json',
    );
  });
  it('uses null for missing fields instead of a mapping title fallback', async () => {
    getJson
      .mockReset()
      .mockResolvedValueOnce(mapping)
      .mockResolvedValue({ cik: 1652044 });
    await expect(service.getCompany('GOOG')).resolves.toEqual({
      ticker: 'GOOG',
      cik: '0001652044',
      name: null,
      sic: null,
      industry: null,
      fiscalYearEnd: null,
    });
  });
  it('converts numeric SIC to a string', async () => {
    getJson
      .mockReset()
      .mockResolvedValueOnce(mapping)
      .mockResolvedValue({ cik: 1652044, sic: 7370 });
    expect((await service.getCompany('GOOG')).sic).toBe('7370');
  });
  it('returns 404 without fetching submissions for an unknown ticker', async () => {
    await expect(service.getCompany('UNKNOWN')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(getJson).toHaveBeenCalledTimes(1);
  });
  it('merges concurrent requests and shares a profile between ticker aliases', async () => {
    const results = await Promise.all(
      ['GOOG', 'GOOG', 'GOOGL'].map((ticker) => service.getCompany(ticker)),
    );
    expect(results.map((x) => x.ticker)).toEqual(['GOOG', 'GOOG', 'GOOGL']);
    await service.getCompany('GOOG');
    expect(getJson).toHaveBeenCalledTimes(2);
  });
  it('refreshes expired profiles and ticker mappings', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.getCompany('GOOG');
    now += 60 * 60 * 1000 + 1;
    await service.getCompany('GOOG');
    expect(getJson).toHaveBeenCalledTimes(3);
    now += 24 * 60 * 60 * 1000;
    getJson.mockResolvedValueOnce(mapping).mockResolvedValueOnce(submission);
    await service.getCompany('GOOG');
    expect(getJson).toHaveBeenCalledTimes(5);
  });
  it('does not cache failed requests', async () => {
    getJson
      .mockReset()
      .mockRejectedValueOnce(new BadGatewayException())
      .mockResolvedValueOnce(mapping)
      .mockResolvedValue(submission);
    await expect(service.getCompany('GOOG')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(service.getCompany('GOOG')).resolves.toHaveProperty(
      'cik',
      '0001652044',
    );
    expect(getJson).toHaveBeenCalledTimes(3);
  });
  it.each([[], {}, { '0': { ticker: 'GOOG', cik_str: 'invalid' } }])(
    'rejects malformed mapping %j',
    async (data) => {
      getJson.mockReset().mockResolvedValue(data);
      await expect(service.getCompany('GOOG')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    },
  );
  it.each([null, [], { cik: '320193' }])(
    'rejects malformed or mismatched submissions %j',
    async (data) => {
      getJson
        .mockReset()
        .mockResolvedValueOnce(mapping)
        .mockResolvedValue(data);
      await expect(service.getCompany('GOOG')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    },
  );
});
