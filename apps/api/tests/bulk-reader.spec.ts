import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildSnapshot,
  parseTickers,
} from '../src/modules/financials/bulk-reader';

const fixture = (name: string) => join(__dirname, 'fixtures', name);
describe('SEC bulk archive processing', () => {
  it('reads matching company entries lazily, shares a CIK across aliases and leaves absent facts null', async () => {
    const tickers = parseTickers(
      JSON.parse(await readFile(fixture('tickers-test.json'), 'utf8')),
    );
    const snapshot = await buildSnapshot(
      fixture('companyfacts-test.zip'),
      tickers,
    );
    expect(snapshot.companies.map((x) => x.ticker)).toEqual([
      'GOOG',
      'GOOGL',
      'TEST',
    ]);
    expect(snapshot.companies[0]).toMatchObject({
      cik: '0001652044',
      revenue: 120,
      netIncome: 12,
      netMargin: 10,
    });
    expect(snapshot.companies[1].revenue).toBe(120);
    expect(snapshot.companies[2].revenue).toBeNull();
  });
  it('rejects corrupt company JSON instead of publishing a partial result', async () => {
    await expect(
      buildSnapshot(fixture('companyfacts-invalid-test.zip'), [
        { ticker: 'GOOG', cik: '0001652044' },
      ]),
    ).rejects.toThrow();
  });
  it('rejects archives with no matching annual data', async () => {
    await expect(
      buildSnapshot(fixture('companyfacts-test.zip'), [
        { ticker: 'TEST', cik: '0000000002' },
      ]),
    ).rejects.toThrow('no supported annual financial data');
  });
  it.each([{}, [], { 0: { ticker: 'GOOG', cik_str: 'bad' } }])(
    'rejects invalid ticker mapping %j',
    (raw) => {
      expect(() => parseTickers(raw)).toThrow();
    },
  );
});
