import {
  defaultTaxRate,
  effectiveTaxRate,
  historicalGrowth,
  industryWacc,
  defaultTerminalGrowth,
  approximateSimpleFcff,
  usIncorporation,
  type SimpleAnnualObservation,
  type SimpleFcffPeriod,
  type ValuationFact,
  type ValuationBaseline,
} from '@company-research/shared';
import {
  simpleValuationInputs,
  type SimpleStoredRow,
} from '../src/modules/valuation/simple-inputs';
import { withResearchFcff } from '../src/modules/valuation/research-fcff';
import { ValuationController } from '../src/modules/valuation/valuation.module';
const fact = (
  value: number | null,
  start = '2025-01-01',
  end = '2025-12-31',
  concept = 'us-gaap:NetCashProvidedByUsedInOperatingActivities',
): ValuationFact => ({
  value,
  start,
  end,
  concept,
  items:
    value === null
      ? []
      : [
          {
            start,
            end,
            val: value,
            unit: 'USD',
            concept,
            accn: '0000000001-26-000001',
            filed: '2026-02-01',
            form: '10-K',
          },
        ],
});
function baseline(): ValuationBaseline {
  return {
    ticker: 'TEST',
    cik: '0000000001',
    name: null,
    asOf: '2025-12-31',
    checkedAt: '2026-02-01',
    applicable: true,
    status: 'REVIEW_REQUIRED',
    warnings: [],
    revenue: fact(1000),
    ocf: fact(200),
    capex: fact(
      50,
      undefined,
      undefined,
      'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment',
    ),
    interest: fact(
      10,
      undefined,
      undefined,
      'us-gaap:InterestExpenseNonoperating',
    ),
    ebit: fact(100),
    fcf: 150,
    fcff: null,
  };
}
const rows = (): SimpleAnnualObservation[] =>
  Array.from({ length: 6 }, (_, i) => ({
    year: 2020 + i,
    start: `${2020 + i}-01-01`,
    end: `${2020 + i}-12-31`,
    revenue: 100 * 1.1 ** i,
    fcf: 10 * 1.2 ** i,
    capex: 5,
    sources: {},
  }));
const period = (): SimpleFcffPeriod => ({
  label: 'TTM',
  start: '2025-01-01',
  end: '2025-12-31',
  ocf: fact(200),
  capex: fact(50),
  interest: fact(10),
  revenue: fact(1000),
  tax: fact(25),
  pretax: fact(100),
  taxSourceValid: true,
  approximationAllowed: true,
  reason: null,
  warnings: [],
});
test('tax methods reject unknown/foreign incorporation and abnormal or mismatched effective rates; preserve explicit zero', () => {
  const p = period();
  expect(effectiveTaxRate(p).value).toBe(0.25);
  p.tax.value = 0;
  expect(effectiveTaxRate(p).value).toBe(0);
  for (const n of [-1, 101]) {
    p.tax.value = n;
    expect(effectiveTaxRate(p).value).toBeNull();
  }
  p.tax.value = 25;
  p.tax.start = '2025-07-01';
  p.pretax.start = '2025-07-01';
  expect(effectiveTaxRate(p).value).toBeNull();
  p.tax.start = '2025-01-01';
  p.pretax.start = '2025-01-01';
  p.pretax.value = 0;
  expect(effectiveTaxRate(p).value).toBeNull();
  expect(defaultTaxRate(null, 'federal', null).value).toBeNull();
  expect(defaultTaxRate(null, 'manual', 0).value).toBe(0);
  expect(defaultTaxRate(null, 'manual', 1.1).value).toBeNull();
  expect(usIncorporation('DE')).toBe(true);
  expect(usIncorporation('F5')).toBe(false);
  expect(usIncorporation(null)).toBeNull();
});
test('CAGR uses six complete annual points for five intervals; missing/nonpositive or discontinuous histories never become fixed 5%', () => {
  expect(historicalGrowth(rows(), 'fcf', 5).value).toBeCloseTo(0.2, 12);
  expect(historicalGrowth(rows(), 'revenue', 3).value).toBeCloseTo(0.1, 12);
  expect(historicalGrowth(rows().slice(1), 'fcf').value).toBeNull();
  const approved = rows();
  approved[5].storedCagrPercent = {
    fcf: { 3: null, 5: null },
    revenue: { 3: null, 5: null },
  };
  expect(historicalGrowth(approved, 'fcf').value).toBeNull();
  approved[5].storedCagrPercent!.fcf[5] = 20;
  expect(historicalGrowth(approved, 'fcf').value).toBeCloseTo(0.2);
  const a = rows();
  a[2].fcf = null;
  expect(historicalGrowth(a, 'fcf').value).toBeNull();
  a[2].fcf = -5;
  expect(historicalGrowth(a, 'fcf').value).toBeNull();
  expect(historicalGrowth(a, 'fcf').referenceValue).toBeCloseTo(0.2);
  a[0].fcf = 0;
  expect(historicalGrowth(a, 'fcf').value).toBeNull();
  const b = rows();
  b[1].end = 'invalid';
  expect(historicalGrowth(b, 'fcf').value).toBeNull();
  const c = rows();
  c[5].capex = 100;
  expect(historicalGrowth(c, 'fcf').value).toBeCloseTo(0.2);
  expect(
    historicalGrowth(c, 'fcf').warnings.some((x) => x.includes('CapEx')),
  ).toBe(true);
});
test('industry references never invent missing category/aggregate rates; inflation default still requires USD', () => {
  const data = {
    date: '2026-01-05',
    source: 'official',
    page: 'official',
    currency: 'USD',
    industries: [
      { name: 'Computers/Peripherals', wacc: 0.097 },
      { name: 'Beverage (Soft)', wacc: 0.063 },
    ],
  };
  expect(industryWacc(data, '3571').value).toBe(0.097);
  expect(industryWacc(data, '7370').value).toBeNull();
  expect(industryWacc(data, '2080').value).toBeNull();
  expect(industryWacc(data, '7370', 'Beverage (Soft)').value).toBe(0.063);
  expect(industryWacc(data, '3571', null).value).toBeNull();
  expect(defaultTerminalGrowth('USD').value).toBe(0.02);
  expect(defaultTerminalGrowth('EUR').value).toBeNull();
});
test('selected tax recalculates approximate FCFF, without using cash paid or missing interest as zero', () => {
  expect(approximateSimpleFcff(period(), 0.21).value).toBe(157.9 / 1e6);
  expect(approximateSimpleFcff(period(), 0.3).value).toBe(157 / 1e6);
  const p = period();
  p.interest.value = null;
  expect(approximateSimpleFcff(p, 0.21).value).toBeNull();
  expect(approximateSimpleFcff(period(), null).value).toBeNull();
  const b = baseline();
  expect(withResearchFcff(b).fcffEstimate?.value).toBe(157.9);
  b.fcffChecks = {
    cashInterest: fact(11),
    capitalizedInterest: fact(null),
    pretax: fact(100),
  };
  expect(withResearchFcff(b, 0).fcffEstimate?.status).toBe('MISSING');
});
test('annual inputs use actual full periods and reported annual interest, not TTM or comparative fy labels', () => {
  const b = baseline();
  const r: SimpleStoredRow = {
    periodStart: new Date('2025-01-01'),
    periodEnd: new Date('2025-12-31'),
    fiscalYear: 2025,
    fiscalQuarter: null,
    currency: 'USD',
    revenue: 1000,
    operatingCashFlow: 200,
    capex: 50,
    operatingIncome: 100,
    sources: Object.fromEntries(
      ['revenue', 'operatingCashFlow', 'capex', 'operatingIncome'].map((k) => {
        const f =
          k === 'capex'
            ? b.capex
            : k === 'operatingIncome'
              ? b.ebit
              : k === 'revenue'
                ? b.revenue
                : b.ocf;
        return [
          k,
          {
            method: 'reported',
            items: f.items.map((x) => ({ ...x, fy: 2028 })),
          },
        ];
      }),
    ),
  };
  const d = simpleValuationInputs(b.cik, b, [r], {
    sic: '3571',
    incorporation: 'CA',
  });
  expect(d.latestAnnual?.start).toBe('2025-01-01');
  expect(d.latestAnnual?.ebitInputs?.workingCapital).toBeNull();
  expect(d.latestAnnual?.ebitInputs?.depreciationAmortization.value).toBeNull();
  expect(d.latestAnnual?.ebitInputs?.cacheIssues.join()).toContain('旧缓存');
  const da = fact(
    20,
    '2025-01-01',
    '2025-12-31',
    'us-gaap:DepreciationDepletionAndAmortization',
  );
  (r.sources as Record<string, unknown>).depreciationAmortization = {
    policyVersion: 'depreciation-amortization-v1',
    value: 20,
    approximate: true,
    sources: da.items.map((x) => ({ ...x, coefficient: 1 })),
    reason: '附注近似',
  };
  const enhanced = simpleValuationInputs(b.cik, b, [r], null);
  expect(
    enhanced.latestAnnual?.ebitInputs?.depreciationAmortization.value,
  ).toBe(20);
  expect(
    enhanced.latestAnnual?.ebitInputs?.depreciationAmortization.approximate,
  ).toBe(true);

  expect(d.annual[0].year).toBe(2025);
  expect(approximateSimpleFcff(d.latestAnnual, 0.21).value).toBe(157.9 / 1e6);
  expect(defaultTaxRate(d, 'federal', null).value).toBe(0.21);
  b.interest = {
    ...b.interest,
    items: [{ ...b.interest.items[0], start: '2025-07-01' }],
  };
  expect(
    simpleValuationInputs(b.cik, b, [r], null).latestAnnual
      ?.approximationAllowed,
  ).toBe(false);
});
test('new parameter input route reads financial caches, tolerates missing profile and never acquires CompanyFacts', async () => {
  const sec = {
    resolveCompany: jest.fn().mockResolvedValue({ cik: '0000000001' }),
    getValuationProfile: jest
      .fn()
      .mockRejectedValue(Error('profile unavailable')),
    getCompanyFacts: jest.fn(),
  };
  const db = {
    annualFinancial: { findMany: jest.fn().mockResolvedValue([]) },
    valuationCache: {
      findUnique: jest.fn().mockResolvedValue({ data: baseline() }),
    },
  };
  const c = new ValuationController(sec as never, {} as never, db as never);
  const out = await c.simpleInputs('TEST');
  expect(out.usIncorporated).toBeNull();
  expect(out.annual).toEqual([]);
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
});

test('WACC exact, configured approximate, nonfinancial aggregate and manual tiers have explicit provenance and financial exclusions', () => {
  const data = {
    date: '2026-01-05',
    source: 'official',
    page: 'official',
    currency: 'USD',
    nonFinancialMarket: {
      name: 'Total Market (without financials)',
      wacc: 0.077,
    },
    industries: [
      { name: 'Computers/Peripherals', wacc: 0.09 },
      { name: 'Computer Services', wacc: 0.08 },
    ],
  };
  expect(industryWacc(data, '3571').tier).toBe('exact');
  expect(industryWacc(data, '7370').tier).toBe('approximate');
  expect(industryWacc(data, '2080').value).toBe(0.077);
  expect(industryWacc(data, '2080').tier).toBe('nonfinancial-market');
  expect(industryWacc(data, '6020').value).toBeNull();
  expect(industryWacc(data, null).value).toBeNull();
  expect(industryWacc(data, '2080', 'Computer Services').tier).toBe('manual');
  expect(industryWacc(data, '2080', null).value).toBeNull();
  expect(
    industryWacc({ ...data, nonFinancialMarket: undefined }, '2080').value,
  ).toBeNull();
  expect(industryWacc({ ...data, industries: [] }, '3571').tier).toBe(
    'nonfinancial-market',
  );
});
