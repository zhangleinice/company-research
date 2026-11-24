import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
import {
  type DebtFiling,
  extractDebtDisclosures,
} from '../src/modules/financials/debt-disclosure';
import {
  annualRoicHistory,
  type RoicStoredPeriod,
  quarterlyRoicHistory,
} from '../src/modules/financials/annual-roic';
import { ValuationController } from '../src/modules/valuation/valuation.module';
const fixture = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/balance-sheet-regression.json'),
    'utf8',
  ),
) as Record<string, { raw: unknown }>;
const manifest = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/debt-filings/manifest.json'), 'utf8'),
) as (DebtFiling & { file: string; sha256: string; ticker: string })[];
const reference = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/annual-roic-reference.json'), 'utf8'),
) as {
  companies: Record<
    string,
    {
      sic: string;
      manual: {
        year: string;
        NOPAT_proxy: number;
        ROIC_proxy: number | null;
        beginIC: number | null;
        endIC: number | null;
      }[];
    }
  >;
};

const extendedFacts = JSON.parse(
  gunzipSync(
    readFileSync(join(__dirname, 'fixtures/roic-history-companyfacts.json.gz')),
  ).toString(),
) as Record<string, { raw: unknown }>;
const latestQuarterManifest = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/debt-filings/latest-quarter-manifest.json'),
    'utf8',
  ),
) as (DebtFiling & { file: string; sha256: string; ticker: string })[];
const extendedHistories = new Map<
  string,
  { annual: RoicStoredPeriod[]; quarterly: RoicStoredPeriod[] }
>();
const histories = new Map<string, RoicStoredPeriod[]>();
beforeAll(() => {
  for (const [ticker, f] of Object.entries(fixture)) {
    const docs = manifest
      .filter((m) => m.ticker === ticker)
      .flatMap((m) => {
        const html = gunzipSync(
          readFileSync(join(__dirname, 'fixtures/debt-filings', m.file)),
        ).toString();
        expect(createHash('sha256').update(html).digest('hex')).toBe(m.sha256);
        return extractDebtDisclosures(html, m);
      });
    const ref = reference.companies[ticker as keyof typeof reference.companies];
    extendedHistories.set(
      ticker,
      JSON.parse(
        JSON.stringify(
          normalizeCompanyFacts(
            extendedFacts[ticker].raw,
            [
              ...docs,
              ...latestQuarterManifest
                .filter((m) => m.ticker === ticker)
                .flatMap((m) => {
                  const html = gunzipSync(
                    readFileSync(
                      join(__dirname, 'fixtures/debt-filings', m.file),
                    ),
                  ).toString();
                  expect(createHash('sha256').update(html).digest('hex')).toBe(
                    m.sha256,
                  );
                  return extractDebtDisclosures(html, m);
                }),
            ],
            ref.sic,
          ),
        ),
      ) as { annual: RoicStoredPeriod[]; quarterly: RoicStoredPeriod[] },
    );
    histories.set(
      ticker,
      JSON.parse(
        JSON.stringify(normalizeCompanyFacts(f.raw, docs, ref.sic).annual),
      ) as RoicStoredPeriod[],
    );
  }
});
it('replays 12 annual results from original SEC facts and filings, with seven approved results matching prior manual calculations', () => {
  let ready = 0;
  let missing = 0;
  for (const [ticker, rows] of histories) {
    const result = annualRoicHistory(rows, '2026-11-24', 3);
    expect(result.results).toHaveLength(3);
    for (const r of result.results) {
      const expectedReady =
        ticker === 'AAPL' ||
        ticker === 'MSFT' ||
        (ticker === 'GOOGL' && r.fiscalYear === 2025);
      expect(r.status).toBe(expectedReady ? 'READY' : 'MISSING_DATA');
      expect(r.operatingIncome).not.toBeNull();
      expect(r.incomeTaxExpense).not.toBeNull();
      expect(r.pretaxIncome).not.toBeNull();
      expect(r.incomeInputs?.operatingIncome.items[0].url).toMatch(
        /^https:\/\/www.sec.gov\/Archives\/edgar\/data\//,
      );
      const manual = reference.companies[
        ticker as keyof typeof reference.companies
      ].manual.find((m) => Number(m.year) === r.fiscalYear)!;
      expect(r.nopat! / 1e6).toBeCloseTo(manual.NOPAT_proxy, 6);
      if (expectedReady) {
        ready++;
        expect(r.roic).toBeCloseTo(manual.ROIC_proxy! / 100, 12);
        expect(r.beginningInvestedCapital! / 1e6).toBe(manual.beginIC);
        expect(r.endingInvestedCapital! / 1e6).toBe(manual.endIC);
      } else {
        missing++;
        expect(r.roic).toBeNull();
        expect(
          r.missingReasons.some((i) => i.field.includes('financingDebt')),
        ).toBe(true);
      }
    }
  }
  expect({ ready, missing }).toEqual({ ready: 7, missing: 5 });
});
it('quality API returns annual DB results without a TTM cache or SEC/AI calls and preserves existing fields', async () => {
  const sec = {
    resolveCompany: jest.fn(),
    getCompanyFacts: jest.fn(),
    getDebtDisclosures: jest.fn(),
  };
  const client = { getJson: jest.fn() };
  const db = {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        cik: '0000320193',
        annualFinancials: histories.get('AAPL'),
      }),
    },
    valuationCache: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const controller = new ValuationController(
    sec as never,
    client as never,
    db as never,
  );
  const result = await controller.quality('AAPL');
  expect(
    result.annualRoic.results.slice(0, 3).every((r) => r.status === 'READY'),
  ).toBe(true);
  expect(result.capex.value).toBeNull();
  expect(result.ticker).toBe('AAPL');
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
  expect(sec.getDebtDisclosures).not.toHaveBeenCalled();
  expect(sec.resolveCompany).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
});
it('alias resolution uses cache identity only; annual amounts still come from annual_financials', async () => {
  const db = {
    company: { findFirst: jest.fn().mockResolvedValue(null) },
    valuationCache: {
      findFirst: jest.fn().mockResolvedValue({ cik: '0001652044', data: null }),
    },
    quarterlyFinancial: { findMany: jest.fn().mockResolvedValue([]) },
    annualFinancial: {
      findMany: jest.fn().mockResolvedValue(histories.get('GOOGL')),
    },
  };
  const controller = new ValuationController(
    {} as never,
    {} as never,
    db as never,
  );
  const result = await controller.quality('GOOG');
  expect(result.annualRoic.results[0].roic).toBeCloseTo(0.367274945401, 10);
  expect(db.annualFinancial.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { companyCik: '0001652044' } }),
  );
});

it('returns aligned ten-year and ten-quarter histories with unchanged seven validated annual results', () => {
  for (const [ticker, rows] of extendedHistories) {
    const annual = annualRoicHistory(rows.annual, '2026-11-24');
    const quarterly = quarterlyRoicHistory(
      rows.quarterly,
      rows.annual,
      '2026-11-24',
    );
    expect(annual.results).toHaveLength(10);
    expect(quarterly.results).toHaveLength(10);
    expect(annual.results.map((r) => r.periodEnd)).toEqual(
      rows.annual.map((r) => r.periodEnd),
    );
    expect(quarterly.results.map((r) => r.periodEnd)).toEqual(
      rows.quarterly.map((r) => r.periodEnd),
    );
    expect(annual.results.filter((r) => r.status === 'READY')).toHaveLength(
      ticker === 'AAPL' || ticker === 'MSFT' ? 3 : ticker === 'GOOGL' ? 1 : 0,
    );
    for (const r of annual.results.filter((r) => r.status === 'READY')) {
      const manual = reference.companies[ticker].manual.find(
        (m) => Number(m.year) === r.fiscalYear,
      )!;
      expect(r.roic).toBeCloseTo(manual.ROIC_proxy! / 100, 12);
    }
    for (const r of quarterly.results) {
      if (ticker === 'MSFT' && r.fiscalYear === 2027 && r.fiscalQuarter === 1) {
        expect(r.status).toBe('READY');
        expect(r.roic).toBeCloseTo(0.07432070374177481, 14);
        expect(r.beginningInvestedCapital).toBe(472432000000);
        expect(r.endingInvestedCapital).toBe(512454000000);
        expect(r.averageInvestedCapital).toBe(492443000000);
      } else {
        expect(r.roic).toBeNull();
        expect(
          r.missingReasons.some((i) => i.field.includes('financingDebt')),
        ).toBe(true);
      }
      expect(r.quarterlyEffectiveTaxRate).not.toBeNull();
      expect(r.nopat).not.toBeNull();
      expect(r.policyVersion).toBe('quarterly-roic-v1');
    }
    for (const r of quarterly.results.filter((r) => r.fiscalQuarter === 4)) {
      expect(r.incomeInputs?.operatingIncome.method).toBe(
        'roic_cumulative_difference_v1',
      );
      expect(r.incomeInputs?.operatingIncome.items).toHaveLength(2);
    }
  }
});
it('quality API returns both persisted modes and keeps cache-only read semantics', async () => {
  const rows = extendedHistories.get('AAPL')!;
  const sec = { getCompanyFacts: jest.fn(), getDebtDisclosures: jest.fn() };
  const db = {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        cik: '0000320193',
        annualFinancials: rows.annual,
        quarterlyFinancials: rows.quarterly,
      }),
    },
    valuationCache: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const controller = new ValuationController(
    sec as never,
    {} as never,
    db as never,
  );
  const result = await controller.quality('AAPL');
  expect(result.annualRoic.results).toHaveLength(10);
  expect(result.quarterlyRoic.results).toHaveLength(10);
  expect(result.quarterlyRoic.annualized).toBe(false);
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
  expect(sec.getDebtDisclosures).not.toHaveBeenCalled();
});
