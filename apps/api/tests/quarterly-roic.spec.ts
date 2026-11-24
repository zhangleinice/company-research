import {
  annualRoicHistory,
  quarterlyRoicHistory,
  type RoicStoredPeriod,
} from '../src/modules/financials/annual-roic';
import { quarterlyRoicInputs } from '../src/modules/financials/quarterly-roic-inputs';
import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
import type {
  BalanceSheetInput,
  BalanceSheetInputs,
  QuarterlyRoicInputs,
} from '@company-research/shared';
const accn = '0000000001-26-000001',
  filed = '2026-11-01',
  asOf = '2026-11-24';
const tags = [
  'OperatingIncomeLoss',
  'IncomeTaxExpenseBenefit',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
];
type Observation = {
  start: string;
  end: string;
  values: [number, number, number];
  filed?: string;
  accn?: string;
  form?: string;
};
function raw(observations: Observation[]) {
  return {
    cik: 1,
    facts: {
      'us-gaap': Object.fromEntries(
        [...tags, 'Revenues'].map((tag, i) => [
          tag,
          {
            units: {
              USD: observations.map((o) => ({
                start: o.start,
                end: o.end,
                val: o.values[Math.min(i, 2)],
                filed: o.filed ?? filed,
                accn: o.accn ?? accn,
                form: o.form ?? '10-Q',
                fy: Number(o.end.slice(0, 4)),
                fp: o.form === '10-K' ? 'FY' : 'Q3',
              })),
            },
          },
        ]),
      ),
    },
  };
}
function quarter(
  start = '2026-04-01',
  end = '2026-06-30',
  q = 2,
  values: [number, number, number] = [25, 5, 25],
  yearStart = '2026-01-01',
): RoicStoredPeriod {
  const filing =
    end > filed
      ? new Date(Date.parse(end) + 30 * 86400000).toISOString().slice(0, 10)
      : filed;
  const income = quarterlyRoicInputs(
    raw([{ start, end, values, filed: filing }]),
    { fiscalYear: 2026, fiscalQuarter: q, periodStart: start, periodEnd: end },
    yearStart,
    '7372',
  );
  const point = (value: number): BalanceSheetInput => ({
    value,
    status: 'VERIFIED',
    method: 'reported',
    reason: null,
    items: [
      { val: value, end, accn, filed: filing, form: '10-Q', unit: 'USD' },
    ],
  });
  const capital: BalanceSheetInputs = {
    version: 2,
    periodEnd: end,
    accessionNumber: accn,
    filed: filing,
    consolidatedEquity: point(100),
    financingDebt: point(100),
    cash: point(20),
    currentFinancialInvestments: point(20),
    financeLeases: point(10),
    financeLeasesIncludedInDebt: true,
    unclassifiedInvestments: point(0),
    debtComponents: {},
  };
  return {
    fiscalYear: 2026,
    fiscalQuarter: q,
    periodStart: start,
    periodEnd: end,
    currency: 'USD',
    sources: { quarterlyRoicInputs: income, balanceSheetInputs: capital },
  };
}
const input = (r: RoicStoredPeriod) =>
  (r.sources as { quarterlyRoicInputs: QuarterlyRoicInputs })
    .quarterlyRoicInputs;
const run = (r = quarter()) =>
  quarterlyRoicHistory([quarter('2026-01-01', '2026-03-31', 1), r], [], asOf)
    .results[0];
it('computes an independent quarter with mean capital and preserves nonannualized decimal units', () => {
  const r = run();
  expect(r.status).toBe('READY');
  expect(r.quarterlyEffectiveTaxRate).toBe(0.2);
  expect(r.nopat).toBe(20);
  expect(r.averageInvestedCapital).toBe(160);
  expect(r.roic).toBe(0.125);
  expect(r.policyVersion).toBe('quarterly-roic-v1');
  expect(quarterlyRoicHistory([quarter()], [], asOf).annualized).toBe(false);
});
it.each([
  [2, '2026-04-01', '2026-06-30', '2026-03-31', 60, 20],
  [3, '2026-07-01', '2026-09-30', '2026-06-30', 90, 60],
  [4, '2026-10-01', '2026-12-31', '2026-09-30', 120, 90],
] as const)(
  'derives Q%i from coherent cumulative bundles, never returning YTD itself',
  (q, start, end, priorEnd, current, prior) => {
    const data = raw([
      {
        start: '2026-01-01',
        end,
        values: [current, current * 0.2, current],
        filed: '2027-02-01',
        form: q === 4 ? '10-K' : '10-Q',
      },
      {
        start: '2026-01-01',
        end: priorEnd,
        values: [prior, prior * 0.2, prior],
        filed: '2026-10-30',
        accn: '0000000001-26-000002',
      },
    ]);
    const e = quarterlyRoicInputs(
      data,
      {
        fiscalYear: 2026,
        fiscalQuarter: q,
        periodStart: start,
        periodEnd: end,
      },
      '2026-01-01',
      '7372',
    );
    expect(e.operatingIncome.value).toBe(current - prior);
    expect(e.incomeTaxExpense.value).toBe((current - prior) * 0.2);
    expect(e.operatingIncome.items).toHaveLength(2);
    const b = quarter(
      q === 2 ? '2026-01-01' : q === 3 ? '2026-04-01' : '2026-07-01',
      priorEnd,
      q - 1,
    );
    const r = quarter(start, end, q);
    (r.sources as Record<string, unknown>).quarterlyRoicInputs = e;
    const result = quarterlyRoicHistory([b, r], [], '2027-02-10').results[0];
    expect(result.status).toBe('READY');
    expect(result.nopat).toBe((current - prior) * 0.8);
    expect(result.roic).toBe(((current - prior) * 0.8) / 160);
  },
);
it('matches a 53-week non-calendar fiscal year using actual dates, including a fiscal-year crossing', () => {
  const b = quarter('2025-09-28', '2025-12-27', 1, [25, 5, 25], '2025-09-28');
  const r = quarter('2025-12-28', '2026-03-28', 2, [25, 5, 25], '2025-09-28');
  expect(quarterlyRoicHistory([b, r], [], asOf).results[0].status).toBe(
    'READY',
  );
  expect(
    quarterlyRoicHistory([b, r], [], asOf).results[0].beginningCapital
      .periodEnd,
  ).toBe('2025-12-27');
  const q4 = quarterlyRoicInputs(
    raw([
      {
        start: '2022-09-25',
        end: '2023-09-30',
        values: [120, 24, 120],
        form: '10-K',
      },
      { start: '2022-09-25', end: '2023-07-01', values: [90, 18, 90] },
    ]),
    {
      fiscalYear: 2023,
      fiscalQuarter: 4,
      periodStart: '2023-07-02',
      periodEnd: '2023-09-30',
    },
    '2022-09-25',
    '3571',
  );
  expect(q4.operatingIncome.value).toBe(30);
});
it('bounds the prior YTD filing to the annual filing instead of mixing later comparative revisions into Q4', () => {
  const data = raw([
    {
      start: '2025-01-01',
      end: '2025-12-31',
      values: [120, 24, 120],
      filed: '2026-02-01',
      form: '10-K',
    },
    {
      start: '2025-01-01',
      end: '2025-09-30',
      values: [90, 18, 90],
      filed: '2025-10-30',
      accn: '0000000001-25-000001',
    },
    {
      start: '2025-01-01',
      end: '2025-09-30',
      values: [999, 99, 999],
      filed: '2026-10-30',
      accn: '0000000001-26-000002',
    },
  ]);
  const e = quarterlyRoicInputs(
    data,
    {
      fiscalYear: 2025,
      fiscalQuarter: 4,
      periodStart: '2025-10-01',
      periodEnd: '2025-12-31',
    },
    '2025-01-01',
    '7372',
  );
  expect(e.operatingIncome.value).toBe(30);
  expect(e.operatingIncome.items[1].filed).toBe('2025-10-30');
});
it('does not use YTD when the preceding cumulative bundle is missing or definitions are conflicting', () => {
  const e = quarterlyRoicInputs(
    raw([{ start: '2026-01-01', end: '2026-06-30', values: [60, 12, 60] }]),
    {
      fiscalYear: 2026,
      fiscalQuarter: 2,
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
    },
    '2026-01-01',
    '7372',
  );
  expect(e.operatingIncome.value).toBeNull();
  const data = raw([
    { start: '2026-01-01', end: '2026-06-30', values: [60, 12, 60] },
    { start: '2026-01-01', end: '2026-03-31', values: [20, 4, 20] },
  ]);
  data.facts['us-gaap'].OperatingIncomeLoss.units.USD.push({
    start: '2026-04-01',
    end: '2026-06-30',
    val: 999,
    filed,
    accn,
    form: '10-Q',
    fy: 2026,
    fp: 'Q2',
  });
  expect(
    quarterlyRoicInputs(
      data,
      {
        fiscalYear: 2026,
        fiscalQuarter: 2,
        periodStart: '2026-04-01',
        periodEnd: '2026-06-30',
      },
      '2026-01-01',
      '7372',
    ).operatingIncome.value,
  ).toBeNull();
});
it.each([
  [25, 0, 25, 'READY', 0.15625],
  [25, 30, 25, 'INVALID_INPUT', null],
  [-25, 5, 25, 'READY', -0.125],
  [1000, 5, 25, 'READY', 5],
  [25, 5, 0, 'INVALID_INPUT', null],
] as const)(
  'keeps quarter tax and return edge policies for %s/%s/%s',
  (op, tax, pre, status, ratio) => {
    const result = run(quarter('2026-04-01', '2026-06-30', 2, [op, tax, pre]));
    expect(result.status).toBe(status);
    expect(result.roic).toBe(ratio);
  },
);
it('rejects old versions, unaudited debt, nonpositive capital and financial firms', () => {
  const r = quarter();
  const s = r.sources as { balanceSheetInputs: BalanceSheetInputs };
  s.balanceSheetInputs.financingDebt.status = 'REVIEW_REQUIRED';
  expect(run(r).roic).toBeNull();
  const zero = quarter();
  (
    zero.sources as { balanceSheetInputs: BalanceSheetInputs }
  ).balanceSheetInputs.consolidatedEquity.value = -100;
  expect(run(zero).status).toBe('INVALID_INPUT');
  const old = quarter();
  Object.assign(input(old), { version: 'old' });
  expect(run(old).roic).toBeNull();
  const bank = quarter();
  input(bank).sic = '6020';
  expect(run(bank).status).toBe('NOT_APPLICABLE');
});
it('never substitutes annual income or another quarter for an exact missing capital boundary', () => {
  const r = quarter();
  const prior = quarter('2026-01-01', '2026-03-30', 1);
  expect(quarterlyRoicHistory([prior, r], [], asOf).results[0].roic).toBeNull();
  expect(annualRoicHistory([r], asOf).results).toHaveLength(0);
  expect(
    quarterlyRoicHistory([{ ...r, fiscalQuarter: null }], [], asOf).results,
  ).toHaveLength(0);
});
it('normalization stores a nonrecursive eleventh capital snapshot without changing public ten-period lists', () => {
  const obs: Observation[] = [];
  for (let y = 2013; y <= 2026; y++)
    obs.push({
      start: `${y}-01-01`,
      end: `${y}-12-31`,
      values: [100, 20, 100],
      filed: `${y + 1}-02-01`,
      form: '10-K',
    });
  for (let y = 2023; y <= 2026; y++)
    for (let q = 1; q <= 3; q++)
      obs.push({
        start: `${y}-${q === 1 ? '01-01' : q === 2 ? '04-01' : '07-01'}`,
        end: `${y}-${q === 1 ? '03-31' : q === 2 ? '06-30' : '09-30'}`,
        values: [25, 5, 25],
        filed: `${y + 1}-02-01`,
      });
  const n = normalizeCompanyFacts(raw(obs), [], '7372');
  expect(n.annual).toHaveLength(10);
  expect(n.quarterly).toHaveLength(10);
  for (const mode of ['annual', 'quarterly'] as const) {
    const opening = n[mode][9].sources.roicBeginningCapital as RoicStoredPeriod;
    expect(opening).toBeDefined();
    expect(
      (opening.sources as Record<string, unknown>).roicBeginningCapital,
    ).toBeUndefined();
    expect(Date.parse(String(opening.periodEnd)) + 86400000).toBe(
      Date.parse(n[mode][9].periodStart),
    );
  }
  expect(annualRoicHistory(n.annual, '2028-01-01').results).toHaveLength(10);
  expect(
    quarterlyRoicHistory(n.quarterly, n.annual, '2028-01-01').results,
  ).toHaveLength(10);
});
it('computes all ten displayed quarters from eleven capital periods or the persisted opening snapshot', () => {
  const all = Array.from({ length: 11 }, (_, i) => {
    const year = 2024 + Math.floor(i / 4),
      q = (i % 4) + 1;
    const start = new Date(Date.UTC(year, (q - 1) * 3, 1))
      .toISOString()
      .slice(0, 10);
    const end = new Date(Date.UTC(year, q * 3, 0)).toISOString().slice(0, 10);
    const r = quarter(start, end, q, [25, 5, 25], `${year}-01-01`);
    r.fiscalYear = year;
    input(r).fiscalYear = year;
    return r;
  });
  expect(
    quarterlyRoicHistory(all, [], asOf).results.every(
      (r) => r.status === 'READY',
    ),
  ).toBe(true);
  const displayed = all.slice(1);
  expect(quarterlyRoicHistory(displayed, [], asOf).results[9].roic).toBeNull();
  (displayed[0].sources as Record<string, unknown>).roicBeginningCapital = {
    ...all[0],
    version: 'roic-capital-snapshot-v1',
    cik: '0000000001',
  };
  const result = quarterlyRoicHistory(
    JSON.parse(JSON.stringify(displayed)),
    [],
    asOf,
  );
  expect(result.results).toHaveLength(10);
  expect(
    result.results.every((r) => r.status === 'READY' && r.roic === 0.125),
  ).toBe(true);
});
it('rejects modified persisted derivation sources and invalid fiscal-year boundaries', () => {
  const data = raw([
    { start: '2026-01-01', end: '2026-06-30', values: [60, 12, 60] },
    { start: '2026-01-01', end: '2026-03-31', values: [20, 4, 20] },
  ]);
  const r = quarter();
  const e = quarterlyRoicInputs(
    data,
    {
      fiscalYear: 2026,
      fiscalQuarter: 2,
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
    },
    '2026-01-01',
    '7372',
  );
  (r.sources as Record<string, unknown>).quarterlyRoicInputs = e;
  expect(run(r).roic).toBe(0.2);
  e.operatingIncome.items[1].val = 999;
  expect(run(r).roic).toBeNull();
  const invalid = quarter();
  input(invalid).fiscalYearStart = '2026-04-01';
  expect(run(invalid).roic).toBeNull();
});

it('accepts a newly verified capital-only opening snapshot without requiring previous-quarter profit or old income caches', () => {
  const r = quarter();
  const b = quarter('2026-01-01', '2026-03-31', 1);
  const snapshot = {
    version: 'roic-capital-snapshot-v1',
    cik: '0000000001',
    fiscalYear: null,
    fiscalQuarter: null,
    periodStart: '2026-03-31',
    periodEnd: '2026-03-31',
    currency: 'USD',
    sources: {
      balanceSheetInputs: (
        b.sources as { balanceSheetInputs: BalanceSheetInputs }
      ).balanceSheetInputs,
    },
  };
  (r.sources as Record<string, unknown>).roicBeginningCapital = snapshot;
  expect(quarterlyRoicHistory([r], [], asOf).results[0].roic).toBe(0.125);
  Object.assign(input(b), { version: 'old' });
  expect(quarterlyRoicHistory([b, r], [], asOf).results[0].roic).toBe(0.125);
  snapshot.cik = '0000000002';
  expect(quarterlyRoicHistory([r], [], asOf).results[0].roic).toBeNull();
});

it('rejects impossible SEC filing dates even when their strings are within the reporting cutoff', () => {
  const r = quarter();
  for (const k of [
    'operatingIncome',
    'incomeTaxExpense',
    'pretaxIncome',
  ] as const)
    input(r)[k].items[0].filed = '2026-06-31';
  expect(run(r).roic).toBeNull();
});
