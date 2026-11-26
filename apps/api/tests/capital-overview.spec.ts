import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  FINANCIAL_METRICS,
  CAPITAL_OVERVIEW_POLICY,
  type FinancialPeriod,
  type CapitalFlowFact,
} from '@company-research/shared';
import { capitalOverview } from '../src/modules/financials/capital-overview';
import { annualCapitalAllocation } from '../src/modules/financials/capital-allocation';
import { cachedCapitalFlowFacts } from '../src/modules/financials/capital-flow-cache';
const cik = '0000000001',
  accn = '0000000001-26-000001';
const row = () =>
  ({
    ...Object.fromEntries(FINANCIAL_METRICS.map((k) => [k, null])),
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    fiscalQuarter: null,
    fiscalYear: 2025,
    currency: 'USD',
    operatingCashFlow: 100,
    capex: 120,
    stockRepurchases: 10,
    dividendsPaid: 20,
  }) as FinancialPeriod;
const source = (tag: string, value: number) => ({
  method: 'reported',
  items: [
    {
      start: '2025-01-01',
      end: '2025-12-31',
      concept: 'us-gaap:' + tag,
      unit: 'USD',
      val: value,
      accn,
      filed: '2026-02-01',
      form: '10-K',
    },
  ],
});
const provenance = () => ({
  operatingCashFlow: source('NetCashProvidedByUsedInOperatingActivities', 100),
  capex: source('PaymentsToAcquirePropertyPlantAndEquipment', 120),
  stockRepurchases: source('PaymentsForRepurchaseOfCommonStock', 10),
  dividendsPaid: source('PaymentsOfDividends', 20),
});
const fact = (tag: string, value: number): CapitalFlowFact => ({
  concept: 'us-gaap:' + tag,
  value,
  start: '2025-01-01',
  end: '2025-12-31',
  accessionNumber: accn,
  filed: '2026-02-01',
  unit: 'USD',
  url: 'https://www.sec.gov/Archives/edgar/data/1/x/index.html',
});
function compute(facts: CapitalFlowFact[], r = row(), p = provenance()) {
  return capitalOverview(
    r,
    annualCapitalAllocation(r, p, cik),
    { version: CAPITAL_OVERVIEW_POLICY, cik, facts },
    p,
  );
}
it('keeps missing vs true zero and negative net directions; ratios can exceed 100 and nonpositive OCF has no ratios', () => {
  const o = compute([
    fact('ProceedsFromIssuanceOfDebt', 0),
    fact(
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
      -20,
    ),
  ]);
  expect(o.items.find((x) => x.key === 'capex')).toMatchObject({
    value: 120,
    ratio: 120,
    direction: 'outflow',
  });
  expect(o.items.find((x) => x.key === 'debtIn')?.value).toBe(0);
  expect(o.items.find((x) => x.key === 'stockIssued')?.value).toBeNull();
  expect(o.items.find((x) => x.key === 'cashChange')).toMatchObject({
    value: -20,
    ratio: -20,
  });
  const r = row();
  r.operatingCashFlow = 0;
  const p = provenance();
  p.operatingCashFlow = source('NetCashProvidedByUsedInOperatingActivities', 0);
  expect(compute([], r, p).items.every((x) => x.ratio === null)).toBe(true);
});
it('prefers aggregate investments and debt, does not add overlapping subcomponents or different accession facts', () => {
  const xs = [
    fact('ProceedsFromIssuanceOfDebt', 50),
    fact('ProceedsFromIssuanceOfLongTermDebt', 30),
    fact('ProceedsFromDisposalsOfInvestments', 70),
    fact('ProceedsFromSaleAndMaturityOfAvailableForSaleSecurities', 10),
    {
      ...fact('ProceedsFromIssuanceOfCommonStock', 9),
      accessionNumber: '0000000001-25-000002',
    },
  ];
  const o = compute(xs);
  expect(o.items.find((x) => x.key === 'debtIn')?.value).toBe(50);
  expect(o.items.find((x) => x.key === 'investSell')?.value).toBe(70);
  expect(o.items.find((x) => x.key === 'stockIssued')?.value).toBeNull();
  const conflict = compute([
    fact('ProceedsFromIssuanceOfDebt', 50),
    fact('ProceedsFromIssuanceOfDebt', 51),
    fact('ProceedsFromIssuanceOfLongTermDebt', 30),
  ]);
  expect(conflict.items.find((x) => x.key === 'debtIn')?.value).toBeNull();
});
it('uses cash-impact signs and avoids adding tax withheld disclosed only in notes to other financing', () => {
  const xs = [
    fact('PaymentsForProceedsFromOtherInvestingActivities', -91),
    fact('CollateralPaidReceivedAssociatedWithHedgingActivitiesNet', -330),
    fact('ProceedsFromPaymentsForOtherFinancingActivities', -2839),
    fact('PaymentsRelatedToTaxWithholdingForShareBasedCompensation', 5600),
  ];
  const o = compute(xs);
  expect(o.items.find((x) => x.key === 'otherInvest')?.value).toBe(421);
  expect(o.items.find((x) => x.key === 'otherFinance')?.value).toBe(-2839);
  xs[3].statement = true;
  expect(compute(xs).items.find((x) => x.key === 'otherFinance')?.value).toBe(
    -8439,
  );
  expect(
    compute([
      fact('NetProceedsPaymentsRelatedToStockBasedAwardActivities', 14167),
      fact('ProceedsFromMinorityShareholders', 400),
    ]).items.find((x) => x.key === 'otherFinance')?.value,
  ).toBe(-13767);
});
it('cash reconciliation retains missing FX and restricted-cash scope, never infers a cash-retention residual', () => {
  const f = [
    fact('NetCashProvidedByUsedInInvestingActivities', -30),
    fact('NetCashProvidedByUsedInFinancingActivities', -40),
    fact(
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
      30,
    ),
  ];
  expect(compute(f).reconciliation).toMatchObject({
    status: 'INCOMPLETE',
    fx: null,
    difference: null,
  });
  f.push(
    fact(
      'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
      0,
    ),
  );
  expect(compute(f).reconciliation.status).toBe('MATCHED');
  f[0].value = -31;
  expect(compute(f).reconciliation).toMatchObject({
    status: 'MATCHED',
    difference: -1,
  });
  f[0].value = -32;
  expect(compute(f).reconciliation.status).toBe('CONFLICT');
});
it('extracts bounded consolidated annual facts from four existing cached filings without fetching or guessing amounts', () => {
  const base = join(__dirname, 'fixtures/debt-filings'),
    manifest = JSON.parse(
      readFileSync(join(base, 'manifest.json'), 'utf8'),
    ) as Array<{
      ticker: string;
      cik: string;
      accessionNumber: string;
      reportDate: string;
      filingDate: string;
      sourceUrl: string;
      file: string;
    }>;
  for (const ticker of ['GOOGL', 'AAPL', 'MSFT', 'KO']) {
    const f = manifest
      .filter((x) => x.ticker === ticker)
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
    const html = gunzipSync(readFileSync(join(base, f.file))).toString();
    const fs = cachedCapitalFlowFacts(html, f);
    expect(fs.length).toBeGreaterThan(5);
    expect(
      fs.every((x) => x.statement && x.unit === 'USD' && x.end <= f.reportDate),
    ).toBe(true);
    expect(
      fs.some((x) =>
        x.concept.endsWith('NetCashProvidedByUsedInInvestingActivities'),
      ),
    ).toBe(true);
    expect(() =>
      cachedCapitalFlowFacts(html, { ...f, cik: '0000000001' }),
    ).toThrow();
  }
});
