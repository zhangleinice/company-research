import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateOperatingWorkingCapital } from '../src/modules/financials/operating-working-capital';
import type {
  NwcCoverageAssessment,
  OperatingWorkingCapital,
  ValuationFact,
} from '@company-research/shared';
const cik = '0000000001',
  accn = '0000000001-26-000001';
const observation = (
  val: number,
  start = '2025-01-01',
  end = '2025-12-31',
) => ({ start, end, val, accn, filed: '2026-02-01', form: '10-K', fy: 2026 });
const flow = (tag: string, val: number): ValuationFact => ({
  value: val,
  start: '2025-01-01',
  end: '2025-12-31',
  concept: `us-gaap:${tag}`,
  items: [{ ...observation(val), unit: 'USD', concept: `us-gaap:${tag}` }],
});
function sample() {
  const entries: Record<string, ReturnType<typeof observation>[]> = {
    Revenues: [observation(1000), observation(800, '2024-01-01', '2024-12-31')],
    IncreaseDecreaseInAccountsReceivable: [observation(10)],
    IncreaseDecreaseInInventories: [observation(4)],
    IncreaseDecreaseInAccountsPayable: [observation(3)],
    IncreaseDecreaseInContractWithCustomerLiability: [observation(2)],
    IncreaseDecreaseInOtherOperatingAssets: [observation(20)],
    IncreaseDecreaseInIncomeTaxes: [observation(-50)],
    IncreaseDecreaseInOperatingCapital: [observation(100)],
  };
  const raw = {
    cik,
    facts: {
      'us-gaap': Object.fromEntries(
        Object.entries(entries).map(([k, v]) => [k, { units: { USD: v } }]),
      ),
    },
  };
  const ocf = flow('NetCashProvidedByUsedInOperatingActivities', 100),
    revenue = flow('Revenues', 1000);
  const run = () =>
    estimateOperatingWorkingCapital(raw, cik, ocf, revenue, 'ANNUAL');
  return { raw, ocf, revenue, run };
}
it('normalizes cash signs, excludes tax/aggregate/mixed amounts and calculates only an explicit partial reference', () => {
  const { run, raw } = sample(),
    before = JSON.stringify(raw),
    r = run();
  expect(r.identifiedCashImpact).toBe(-9);
  expect(r.operatingCash.increment).toBe(4);
  expect(r.partialValue).toBe(13);
  expect(r.defaultValue).toBeNull();
  expect(r.completeValue).toBeNull();
  expect(r.status).toBe('PARTIAL');
  expect(r.items.find((x) => x.category === 'otherAssets')).toMatchObject({
    status: 'UNRESOLVED',
    cashImpact: -20,
  });
  expect(r.items.find((x) => x.category === 'incomeTaxes')).toMatchObject({
    status: 'EXCLUDED',
    cashImpact: -50,
  });
  expect(
    r.items.find((x) => x.category === 'operatingCapitalAggregate')?.status,
  ).toBe('EXCLUDED');
  expect(JSON.stringify(raw)).toBe(before);
});
it('counts aliases once, preserves zero, and blocks conflicting aliases', () => {
  const s = sample(),
    f = s.raw.facts['us-gaap'];
  f.IncreaseDecreaseInDeferredRevenue = { units: { USD: [observation(2)] } };
  expect(s.run().partialValue).toBe(13);
  expect(
    s
      .run()
      .items.find((x) => x.category === 'deferredRevenue')
      ?.sources.some((x) => x.aliasExcluded === true),
  ).toBe(true);
  f.IncreaseDecreaseInDeferredRevenue.units.USD[0].val = 9;
  expect(s.run().status).toBe('CONFLICT');
  expect(s.run().partialValue).toBeNull();
  delete f.IncreaseDecreaseInDeferredRevenue;
  for (const tag of [
    'IncreaseDecreaseInAccountsReceivable',
    'IncreaseDecreaseInInventories',
    'IncreaseDecreaseInAccountsPayable',
    'IncreaseDecreaseInContractWithCustomerLiability',
  ])
    f[tag].units.USD[0].val = 0;
  f.Revenues.units.USD[1].val = 1000;
  expect(s.run().identifiedCashImpact).toBe(0);
  expect(s.run().partialValue).toBe(0);
  delete f.IncreaseDecreaseInAccountsPayable;
  delete f.IncreaseDecreaseInContractWithCustomerLiability;
  expect(s.run().partialValue).toBeNull();
});
it('permits negative cash requirements and negative delta; missing prior revenue never becomes zero', () => {
  const s = sample();
  s.raw.facts['us-gaap'].Revenues.units.USD[0].val = 600;
  s.revenue.value = 600;
  s.raw.facts['us-gaap'].IncreaseDecreaseInAccountsReceivable.units.USD[0].val =
    -10;
  expect(s.run().operatingCash.increment).toBe(-4);
  expect(s.run().partialValue).toBe(-15);
  s.raw.facts['us-gaap'].Revenues.units.USD.splice(1);
  expect(s.run().operatingCash.increment).toBeNull();
  expect(s.run().partialValue).toBeNull();
});
it('requires actual periods, units, entity and accession provenance; never uses fy to relabel history', () => {
  const s = sample();
  expect(s.run().periodStart).toBe('2025-01-01');
  s.raw.facts['us-gaap'].IncreaseDecreaseInAccountsPayable.units.USD[0].accn =
    'other';
  delete s.raw.facts['us-gaap'].IncreaseDecreaseInContractWithCustomerLiability;
  expect(s.run().partialValue).toBeNull();
  s.revenue.value = 999;
  expect(s.run().operatingCash.increment).toBeNull();
  expect(
    estimateOperatingWorkingCapital(
      s.raw,
      '0000000002',
      s.ocf,
      s.revenue,
      'ANNUAL',
    ).partialValue,
  ).toBeNull();
  const q = { ...s.ocf, start: '2025-07-01', end: '2025-09-30' };
  expect(
    estimateOperatingWorkingCapital(s.raw, cik, q, s.revenue, 'TTM')
      .partialValue,
  ).toBeNull();
});
const assessment = (
  r: OperatingWorkingCapital,
  status: NwcCoverageAssessment['status'],
): NwcCoverageAssessment => ({
  cik,
  start: '2025-01-01',
  end: '2025-12-31',
  accessions: [accn],
  status,
  evidence: '同申报现金流及附注明确范围',
  omissions: r.items
    .filter((x) => ['MISSING', 'UNRESOLVED'].includes(x.status))
    .map((x) => ({
      category: x.category,
      treatment: x.sources.length ? 'IMMATERIAL' : 'NOT_APPLICABLE',
      evidence: '已核对该申报的项目性质及遗漏影响',
    })),
});
it('requires bound evidence to upgrade representativeness; known mixed data cannot be waived into complete coverage', () => {
  const s = sample(),
    r = s.run(),
    proof = assessment(r, 'REPRESENTATIVE');
  const approx = estimateOperatingWorkingCapital(
    s.raw,
    cik,
    s.ocf,
    s.revenue,
    'ANNUAL',
    { coverage: proof },
  );
  expect(approx.defaultValue).toBe(13);
  expect(approx.approximateValue).toBe(13);
  expect(approx.completeValue).toBeNull();
  expect(approx.coverageAssessment?.evidence).toBe(proof.evidence);
  proof.accessions = ['other'];
  expect(
    estimateOperatingWorkingCapital(s.raw, cik, s.ocf, s.revenue, 'ANNUAL', {
      coverage: proof,
    }).defaultValue,
  ).toBeNull();
  const full = assessment(r, 'COMPLETE');
  full.omissions.forEach((x) => (x.treatment = 'NOT_APPLICABLE'));
  expect(
    estimateOperatingWorkingCapital(s.raw, cik, s.ocf, s.revenue, 'ANNUAL', {
      coverage: full,
    }).defaultValue,
  ).toBeNull();
  const qualifications = [
    {
      cik,
      accession: accn,
      concept: 'us-gaap:IncreaseDecreaseInOtherOperatingAssets',
      classification: 'EXCLUDED' as const,
      evidence: '确认属于非经营投资变动',
    },
  ];
  const accepted = estimateOperatingWorkingCapital(
    s.raw,
    cik,
    s.ocf,
    s.revenue,
    'ANNUAL',
    { coverage: full, qualifications },
  );
  expect(accepted.completeValue).toBe(13);
  expect(accepted.status).toBe('COMPLETE');
});
it('does not double sum qualified broad liabilities with their identified children', () => {
  const s = sample();
  s.raw.facts[
    'us-gaap'
  ].IncreaseDecreaseInAccountsPayableAndAccruedLiabilities = {
    units: { USD: [observation(100)] },
  };
  const r = estimateOperatingWorkingCapital(
    s.raw,
    cik,
    s.ocf,
    s.revenue,
    'ANNUAL',
    {
      qualifications: [
        {
          cik,
          accession: accn,
          concept:
            'us-gaap:IncreaseDecreaseInAccountsPayableAndAccruedLiabilities',
          classification: 'OPERATING',
          evidence: '经营合计但尚未区分重复分项',
        },
      ],
    },
  );
  expect(r.partialValue).toBe(13);
  expect(r.items.find((x) => x.category === 'combinedPayables')?.status).toBe(
    'UNRESOLVED',
  );
});
const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/operating-nwc-regression.json'),
    'utf8',
  ),
).companies as Array<{
  ticker: string;
  cik: string;
  raw: unknown;
  annual: { ocf: ValuationFact; revenue: ValuationFact };
  ttm: { ocf: ValuationFact; revenue: ValuationFact };
}>;
it.each([
  ['GOOGL', 6508.36, 9684.44],
  ['AAPL', 8697.46, 8697.46],
  ['MSFT', -428.7, -1363.34],
  ['KO', null, null],
])(
  'SEC %s annual/TTM partial results remain distinct from complete/default FCFF inputs',
  (ticker, annual, ttm) => {
    const f = fixtures.find((x) => x.ticker === ticker)!;
    for (const [kind, expected] of [
      ['annual', annual],
      ['ttm', ttm],
    ] as const) {
      const anchor = f[kind],
        r = estimateOperatingWorkingCapital(
          f.raw,
          f.cik,
          anchor.ocf,
          anchor.revenue,
          kind === 'annual' ? 'ANNUAL' : 'TTM',
        );
      if (expected === null) expect(r.partialValue).toBeNull();
      else expect(r.partialValue! / 1e6).toBeCloseTo(expected as number, 8);
      expect(r.defaultValue).toBeNull();
      expect(r.completeValue).toBeNull();
      expect(r.requiresUserAdjustment).toBe(true);
      expect(r.operatingCash.increment).not.toBeNull();
      expect(
        r.items.some(
          (x) =>
            x.sources.length && ['UNRESOLVED', 'EXCLUDED'].includes(x.status),
        ),
      ).toBe(true);
    }
  },
);
it('GOOGL prior TTM revenue comes from compatible raw filings, not the mismatching historical quarter-cache sum', () => {
  const f = fixtures.find((x) => x.ticker === 'GOOGL')!,
    r = estimateOperatingWorkingCapital(
      f.raw,
      f.cik,
      f.ttm.ocf,
      f.ttm.revenue,
      'TTM',
    );
  expect(r.operatingCash.priorRevenue.value).toBe(385476e6);
  expect(r.operatingCash.increment).toBeCloseTo(1712.44e6);
  const inv = r.items.find((x) => x.category === 'inventories')!;
  expect(inv.status).toBe('MISSING');
  expect(inv.cashImpact).toBeNull();
  expect(inv.sources.length).toBeGreaterThan(0);
});
it('AAPL other receivables need operating-scope evidence and never apply to an unrelated accession', () => {
  const f = fixtures.find((x) => x.ticker === 'AAPL')!,
    r = estimateOperatingWorkingCapital(
      f.raw,
      f.cik,
      f.ttm.ocf,
      f.ttm.revenue,
      'TTM',
    );
  expect(r.items.find((x) => x.category === 'otherReceivables')).toMatchObject({
    status: 'INCLUDED',
    cashImpact: -6716e6,
  });
  const s = sample();
  s.raw.facts['us-gaap'].IncreaseDecreaseInOtherReceivables = {
    units: { USD: [observation(100)] },
  };
  expect(
    s.run().items.find((x) => x.category === 'otherReceivables')?.status,
  ).toBe('UNRESOLVED');
});
it('balance-sheet verification never replaces cash-flow inputs or changes the partial estimate', () => {
  const s = sample();
  const stock = (val: number, end: string) => {
    const { start: _, ...rest } = observation(val);
    void _;
    return { ...rest, end };
  };
  Object.assign(s.raw.facts['us-gaap'], {
    AccountsReceivableNetCurrent: {
      units: { USD: [stock(40, '2024-12-31'), stock(50, '2025-12-31')] },
    },
    AccountsPayableCurrent: {
      units: { USD: [stock(20, '2024-12-31'), stock(23, '2025-12-31')] },
    },
  });
  expect(s.run().balanceSheetCheck?.change).toBe(7);
  expect(s.run().balanceSheetCheck?.difference).toBe(0);
  expect(s.run().partialValue).toBe(13);
});

it('does not accept non-USD or segment facts and does not promote mixed net-zero lines to complete', () => {
  const s = sample();
  const ap = s.raw.facts['us-gaap'].IncreaseDecreaseInAccountsPayable;
  Object.assign(ap.units, { EUR: ap.units.USD });
  delete (ap.units as Partial<typeof ap.units>).USD;
  delete s.raw.facts['us-gaap'].IncreaseDecreaseInContractWithCustomerLiability;
  expect(s.run().partialValue).toBeNull();
  const q = sample();
  Object.assign(
    q.raw.facts['us-gaap'].IncreaseDecreaseInAccountsReceivable.units.USD[0],
    { segment: {} },
  );
  expect(
    q.run().items.find((x) => x.category === 'receivables')?.cashImpact,
  ).toBeNull();
  q.raw.facts[
    'us-gaap'
  ].IncreaseDecreaseInOtherOperatingAssets.units.USD[0].val = 0;
  expect(q.run().completeValue).toBeNull();
});
it('retains changing scope across TTM legs as unresolved instead of excluding the whole period', () => {
  const f = fixtures.find((x) => x.ticker === 'MSFT')!;
  const acc = String(f.ttm.ocf.items[0].accn);
  const r = estimateOperatingWorkingCapital(
    f.raw,
    f.cik,
    f.ttm.ocf,
    f.ttm.revenue,
    'TTM',
    {
      qualifications: [
        {
          cik: f.cik,
          accession: acc,
          concept: 'us-gaap:IncreaseDecreaseInAccountsPayable',
          classification: 'EXCLUDED',
          evidence: '该申报存在需排除的非经营部分，其他腿尚未核准',
        },
      ],
    },
  );
  expect(r.items.find((x) => x.category === 'payables')?.status).toBe(
    'UNRESOLVED',
  );
  expect(r.completeValue).toBeNull();
});

it('rejects TTM cumulative comparisons from incompatible filings before producing an estimate', () => {
  const f = structuredClone(fixtures.find((x) => x.ticker === 'GOOGL')!);
  f.ttm.ocf.items[2].accn = '0001652044-25-000091';
  const r = estimateOperatingWorkingCapital(
    f.raw,
    f.cik,
    f.ttm.ocf,
    f.ttm.revenue,
    'TTM',
  );
  expect(r.partialValue).toBeNull();
  expect(r.warnings.join()).toContain('同申报');
});
