import {
  annualRoicHistory,
  type RoicStoredPeriod,
} from '../src/modules/financials/annual-roic';
import { annualRoicInputs } from '../src/modules/financials/annual-roic-inputs';
import type {
  AnnualRoicInputs,
  BalanceSheetInputs,
  BalanceSheetInput,
} from '@company-research/shared';
const accn = '0000000001-26-000001',
  filed = '2026-02-01';
const asOf = '2026-11-24';
const point = (value: number, end: string): BalanceSheetInput => ({
  value,
  status: 'VERIFIED',
  reason: null,
  method: 'reported',
  items: [{ val: value, end, accn, filed, form: '10-K', unit: 'USD' }],
});
function row(year: number): RoicStoredPeriod {
  const end = `${year}-12-31`,
    start = `${year}-01-01`;
  const flow = (value: number) => ({
    ...point(value, end),
    items: [{ val: value, start, end, accn, filed, form: '10-K', unit: 'USD' }],
  });
  const income: AnnualRoicInputs = {
    version: 'annual-roic-inputs-v1',
    fiscalYear: year,
    periodStart: start,
    periodEnd: end,
    currency: 'USD',
    cik: '0000000001',
    sic: '7372',
    industrySourceUrl: 'https://data.sec.gov/submissions/CIK0000000001.json',
    operatingIncome: flow(100),
    incomeTaxExpense: flow(20),
    pretaxIncome: flow(100),
    taxDisclosures: [],
  };
  const capital: BalanceSheetInputs = {
    version: 2,
    periodEnd: end,
    accessionNumber: accn,
    filed,
    consolidatedEquity: point(100, end),
    financingDebt: point(100, end),
    cash: point(20, end),
    currentFinancialInvestments: point(20, end),
    unclassifiedInvestments: point(0, end),
    financeLeases: point(10, end),
    financeLeasesIncludedInDebt: true,
    debtComponents: {},
  };
  return {
    fiscalYear: year,
    fiscalQuarter: null,
    periodStart: start,
    periodEnd: end,
    currency: 'USD',
    sources: { annualRoicInputs: income, balanceSheetInputs: capital },
  };
}
const source = (r: RoicStoredPeriod) =>
  r.sources as {
    annualRoicInputs: AnnualRoicInputs;
    balanceSheetInputs: BalanceSheetInputs;
  };
const run = (rows = [row(2024), row(2025)]) =>
  annualRoicHistory(rows, asOf).results[0];
function dates(r: RoicStoredPeriod, start: string, end: string) {
  r.periodStart = start;
  r.periodEnd = end;
  const s = source(r),
    e = s.annualRoicInputs;
  e.periodStart = start;
  e.periodEnd = end;
  for (const key of [
    'operatingIncome',
    'incomeTaxExpense',
    'pretaxIncome',
  ] as const)
    for (const x of e[key].items) {
      x.start = start;
      x.end = end;
    }
  s.balanceSheetInputs.periodEnd = end;
  for (const v of Object.values(s.balanceSheetInputs))
    if (v && typeof v === 'object' && 'items' in v)
      for (const x of v.items) x.end = end;
}
it('calculates an unrounded annual reference ratio with original components and versioned sources', () => {
  const r = run();
  expect(r.status).toBe('READY');
  expect(r.historicalEffectiveTaxRate).toBe(0.2);
  expect(r.nopat).toBe(80);
  expect(r.beginningInvestedCapital).toBe(160);
  expect(r.endingInvestedCapital).toBe(160);
  expect(r.averageInvestedCapital).toBe(160);
  expect(r.roic).toBe(0.5);
  expect(r.policyVersion).toBe('annual-roic-v1');
  expect(r.incomeInputs?.operatingIncome.items[0].accn).toBe(accn);
  expect(
    JSON.parse(JSON.stringify(r)).endingCapital.components.financingDebt.value,
  ).toBe(100);
});
it.each([0, 100])(
  'keeps an explicitly disclosed tax expense %s without replacing it with a default',
  (tax) => {
    const rs = [row(2024), row(2025)];
    source(rs[1]).annualRoicInputs.incomeTaxExpense.value = tax;
    const r = run(rs);
    expect(r.status).toBe('READY');
    expect(r.historicalEffectiveTaxRate).toBe(tax / 100);
    expect(r.nopat).toBe(100 * (1 - tax / 100));
  },
);
it.each([-20, 120])(
  'retains abnormal effective tax rate for inspection, without clamping: tax=%s',
  (tax) => {
    const rs = [row(2024), row(2025)];
    source(rs[1]).annualRoicInputs.incomeTaxExpense.value = tax;
    const r = run(rs);
    expect(r.historicalEffectiveTaxRate).toBe(tax / 100);
    expect(r.nopat).toBeNull();
    expect(r.roic).toBeNull();
    expect(r.status).toBe('INVALID_INPUT');
    expect(r.missingReasons.some((x) => x.code === 'ABNORMAL_TAX_RATE')).toBe(
      true,
    );
  },
);
it.each([0, -100])(
  'does not apply an effective tax rate to nonpositive pretax income %s',
  (pretax) => {
    const rs = [row(2024), row(2025)];
    source(rs[1]).annualRoicInputs.pretaxIncome.value = pretax;
    expect(run(rs).historicalEffectiveTaxRate).toBeNull();
    expect(run(rs).roic).toBeNull();
  },
);
it('allows negative operating ROIC and does not add a separate tax shield', () => {
  const rs = [row(2024), row(2025)];
  source(rs[1]).annualRoicInputs.operatingIncome.value = -100;
  const r = run(rs);
  expect(r.nopat).toBe(-80);
  expect(r.roic).toBe(-0.5);
  expect(r.status).toBe('READY');
});
it('does not cap ROIC at 100% or round the tax rate or NOPAT', () => {
  const rs = [row(2024), row(2025)],
    e = source(rs[1]).annualRoicInputs;
  e.operatingIncome.value = 1000;
  e.incomeTaxExpense.value = 1;
  e.pretaxIncome.value = 3;
  const r = run(rs);
  expect(r.roic).toBeCloseTo((1000 * (1 - 1 / 3)) / 160, 14);
  expect(r.roic!).toBeGreaterThan(1);
  expect(r.roic).not.toBe(Number(r.roic!.toFixed(2)));
});
it.each([0, -1])(
  'rejects a nonpositive beginning capital of %s and never substitutes ending capital',
  (value) => {
    const rs = [row(2024), row(2025)],
      c = source(rs[0]).balanceSheetInputs;
    c.consolidatedEquity.value = 40 + value;
    c.financingDebt.value = 0;
    const r = run(rs);
    expect(r.beginningInvestedCapital).toBe(value);
    expect(r.endingInvestedCapital).toBe(160);
    expect(r.averageInvestedCapital).toBeNull();
    expect(r.roic).toBeNull();
    expect(r.status).toBe('INVALID_INPUT');
  },
);
it('accepts negative consolidated equity when final invested capital remains positive', () => {
  const rs = [row(2024), row(2025)];
  for (const r of rs) {
    const c = source(r).balanceSheetInputs;
    c.consolidatedEquity.value = -10;
    c.financingDebt.value = 200;
  }
  expect(run(rs).beginningInvestedCapital).toBe(150);
  expect(run(rs).status).toBe('READY');
});
it('rejects unapproved financing debt rather than falling back to legacy totalDebt', () => {
  const rs = [row(2024), row(2025)];
  source(rs[1]).balanceSheetInputs.financingDebt.status = 'REVIEW_REQUIRED';
  Object.assign(rs[1], { totalDebt: 999 });
  const r = run(rs);
  expect(r.endingInvestedCapital).toBeNull();
  expect(r.roic).toBeNull();
  expect(
    r.missingReasons.some((x) => x.field === 'endingCapital.financingDebt'),
  ).toBe(true);
});
it('does not fill missing components with zero or use old caches lacking the new annual source version', () => {
  const rs = [row(2024), row(2025)];
  source(rs[1]).balanceSheetInputs.cash.value = null;
  expect(run(rs).roic).toBeNull();
  delete (rs[1].sources as Record<string, unknown>).annualRoicInputs;
  Object.assign(rs[1], {
    operatingIncome: 100,
    incomeTaxExpense: 20,
    pretaxIncome: 100,
  });
  expect(run(rs).operatingIncome).toBeNull();
  expect(run(rs).roic).toBeNull();
});
it('matches the actual prior day across a 53-week fiscal year, not a calendar-year assumption', () => {
  const rs = [row(2023), row(2024)];
  dates(rs[0], '2022-09-25', '2023-09-30');
  dates(rs[1], '2023-10-01', '2024-09-28');
  expect(run(rs).beginningCapital.periodEnd).toBe('2023-09-30');
  expect(run(rs).status).toBe('READY');
  dates(rs[0], '2022-09-25', '2023-09-29');
  expect(run(rs).beginningInvestedCapital).toBeNull();
});
it('rejects quarterly/TTM inputs and mismatched annual source filing tuples', () => {
  const rs = [row(2024), row(2025)];
  rs[1].fiscalQuarter = 4;
  expect(annualRoicHistory([rs[1]], asOf).results).toEqual([]);
  rs[1].fiscalQuarter = null;
  source(rs[1]).annualRoicInputs.operatingIncome.items[0].form = '10-Q';
  expect(run(rs).roic).toBeNull();
  source(rs[1]).annualRoicInputs.operatingIncome.items[0].form = '10-K';
  source(rs[1]).annualRoicInputs.pretaxIncome.items[0].accn =
    '0000000001-26-000002';
  expect(
    run(rs).missingReasons.some((x) => x.code === 'ANNUAL_INCOME_CONFLICT'),
  ).toBe(true);
});
it('keeps unrelated years available and does not require prior-year profit to calculate current-year capital', () => {
  const rs = [row(2022), row(2023), row(2024), row(2025)];
  source(rs[2]).annualRoicInputs.incomeTaxExpense.value = null;
  expect(annualRoicHistory(rs, asOf, 3).results.map((x) => x.status)).toEqual([
    'READY',
    'MISSING_DATA',
    'READY',
  ]);
  source(rs[2]).balanceSheetInputs.financingDebt.status = 'REVIEW_REQUIRED';
  expect(annualRoicHistory(rs, asOf, 3).results.map((x) => x.status)).toEqual([
    'MISSING_DATA',
    'MISSING_DATA',
    'READY',
  ]);
});
it('excludes financial enterprises and leaves unknown industry applicability missing', () => {
  const rs = [row(2024), row(2025)];
  source(rs[1]).annualRoicInputs.sic = '6020';
  expect(run(rs).status).toBe('NOT_APPLICABLE');
  expect(run(rs).roic).toBeNull();
  expect(run(rs).endingCapital.investedCapital).toBeNull();
  source(rs[1]).annualRoicInputs.sic = null;
  expect(run(rs).status).toBe('MISSING_DATA');
  expect(run(rs).roic).toBeNull();
});
it('requires the same company, date, currency and filing provenance on both capital snapshots', () => {
  const rs = [row(2024), row(2025)];
  source(rs[0]).annualRoicInputs.cik = '0000000002';
  expect(run(rs).roic).toBeNull();
  source(rs[0]).annualRoicInputs.cik = '0000000001';
  source(rs[1]).balanceSheetInputs.cash.items[0].accn = '0000000001-25-000003';
  expect(run(rs).roic).toBeNull();
  source(rs[1]).balanceSheetInputs.cash.items[0].accn = accn;
  rs[1].currency = 'EUR';
  expect(run(rs).roic).toBeNull();
});
it('leaves duplicate periods, missing beginning balances and future SEC sources unapproved', () => {
  const rs = [row(2024), row(2025)];
  expect(run([rs[1]]).roic).toBeNull();
  expect(run([...rs, structuredClone(rs[1])]).roic).toBeNull();
  for (const k of [
    'operatingIncome',
    'incomeTaxExpense',
    'pretaxIncome',
  ] as const)
    source(rs[1]).annualRoicInputs[k].items[0].filed = '2027-02-01';
  expect(run(rs).roic).toBeNull();
});
it('keeps nonfinite arithmetic out of the API', () => {
  const rs = [row(2024), row(2025)];
  source(rs[1]).balanceSheetInputs.consolidatedEquity.value = Number.MAX_VALUE;
  source(rs[1]).balanceSheetInputs.financingDebt.value = Number.MAX_VALUE;
  const r = run(rs);
  expect(r.endingInvestedCapital).toBeNull();
  expect(r.roic).toBeNull();
  expect(JSON.stringify(r)).not.toContain('Infinity');
});

const incomeRaw = (values = { op: 100, tax: 20, pretax: 100 }) => ({
  cik: 1,
  facts: {
    'us-gaap': Object.fromEntries(
      Object.entries({
        OperatingIncomeLoss: values.op,
        IncomeTaxExpenseBenefit: values.tax,
        IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest:
          values.pretax,
      }).map(([tag, val]) => [
        tag,
        {
          units: {
            USD: [
              {
                start: '2025-01-01',
                end: '2025-12-31',
                val,
                filed,
                accn,
                form: '10-K',
                fp: 'FY',
                fy: 2026,
              },
            ],
          },
        },
      ]),
    ),
  },
});
const period = {
  fiscalYear: 2025,
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
};
it('extracts actual annual periods despite misleading comparative fy and persists without circular row references', () => {
  const raw = incomeRaw();
  const e = annualRoicInputs(
    raw,
    { ...period, sources: {} } as typeof period,
    '7372',
  );
  expect(e.fiscalYear).toBe(2025);
  expect(e.operatingIncome.value).toBe(100);
  expect(JSON.parse(JSON.stringify(e)).sources).toBeUndefined();
  expect(e.operatingIncome.items[0].url).toContain('/1/000000000126000001/');
});
it('does not backfill revised annual profit with incompatible older tax figures', () => {
  const raw = incomeRaw();
  const xs = raw.facts['us-gaap'].OperatingIncomeLoss.units.USD;
  xs.push({
    ...xs[0],
    val: 110,
    filed: '2026-03-01',
    accn: '0000000001-26-000002',
  });
  const e = annualRoicInputs(raw, period, '7372');
  expect(e.operatingIncome.value).toBe(110);
  expect(e.incomeTaxExpense.value).toBeNull();
  xs[1].val = 100;
  expect(annualRoicInputs(raw, period, '7372').incomeTaxExpense.value).toBe(20);
});
it('rejects YTD, another currency, dimensions and conflicting same-filing annual values', () => {
  const raw = incomeRaw();
  raw.facts['us-gaap'].IncomeTaxExpenseBenefit.units.USD[0].start =
    '2025-04-01';
  expect(
    annualRoicInputs(raw, period, '7372').incomeTaxExpense.value,
  ).toBeNull();
  const b = incomeRaw();
  b.facts['us-gaap'].IncomeTaxExpenseBenefit.units.USD.push({
    ...b.facts['us-gaap'].IncomeTaxExpenseBenefit.units.USD[0],
    val: 30,
  });
  expect(annualRoicInputs(b, period, '7372').incomeTaxExpense.value).toBeNull();
});

it('rejects non-USD and dimensioned income facts without substituting zero', () => {
  for (const mode of ['currency', 'dimensions']) {
    const raw = incomeRaw();
    const units: Record<string, unknown> =
      raw.facts['us-gaap'].IncomeTaxExpenseBenefit.units;
    if (mode === 'currency') {
      units.EUR = units.USD;
      delete units.USD;
    } else {
      Object.assign(raw.facts['us-gaap'].IncomeTaxExpenseBenefit.units.USD[0], {
        dimensions: { segment: 'example' },
      });
    }
    expect(
      annualRoicInputs(raw, period, '7372').incomeTaxExpense.value,
    ).toBeNull();
  }
});
it('retains sourced tax reconciliation warnings and reported tax expense without normalization', () => {
  const a = row(2024),
    b = row(2025);
  const s = source(b).annualRoicInputs;
  s.taxDisclosures.push({
    concept: 'us-gaap:IncomeTaxReconciliationOtherAdjustments',
    label: '其他税费调节项',
    input: s.incomeTaxExpense,
  });
  const result = run([a, b]);
  expect(
    result.warnings.some((w) => w.code === 'DISCLOSED_TAX_RECONCILIATION'),
  ).toBe(true);
  expect(result.incomeTaxExpense).toBe(20);
  expect(result.nopat).toBe(80);
  expect(result.roic).toBe(0.5);
});
it('supports ten or arbitrary annual histories and the oldest opening snapshot without requiring an eleventh displayed row', () => {
  const rows = Array.from({ length: 14 }, (_, i) => row(2012 + i));
  expect(annualRoicHistory(rows, asOf).results).toHaveLength(10);
  expect(annualRoicHistory(rows, asOf, 12).results).toHaveLength(12);
  expect(
    annualRoicHistory(rows, asOf, 12).results.every(
      (r) => r.status === 'READY',
    ),
  ).toBe(true);
  const displayed = rows.slice(-10);
  expect(annualRoicHistory(displayed, asOf).results[9].roic).toBeNull();
  const previous = rows[rows.length - 11];
  (displayed[0].sources as Record<string, unknown>).roicBeginningCapital = {
    ...previous,
    version: 'roic-capital-snapshot-v1',
    cik: '0000000001',
  };
  expect(
    annualRoicHistory(
      JSON.parse(JSON.stringify(displayed)),
      asOf,
    ).results.every((r) => r.status === 'READY'),
  ).toBe(true);
});
