import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
import {
  cashFlowQualityMetrics,
  capexToOperatingCashFlow,
} from '../src/modules/financials/cash-flow-calculations';

describe('CapEx / OCF percentage', () => {
  it('uses percentage points, preserving zero CapEx and ratios above 100%', () => {
    expect(capexToOperatingCashFlow(91447, 164713)).toBeCloseTo(55.51899364);
    expect(capexToOperatingCashFlow(0, 10)).toBe(0);
    expect(capexToOperatingCashFlow(15, 10)).toBe(150);
  });
  it.each([
    [null, 10],
    [10, null],
    [10, 0],
    [10, -1],
    [-1, 10],
    [NaN, 10],
    [10, Infinity],
  ] as [number | null, number | null][])(
    'preserves missing/invalid inputs (%s, %s)',
    (capex, ocf) => {
      expect(capexToOperatingCashFlow(capex, ocf)).toBeNull();
    },
  );
});

describe('same-period cash flow quality percentages', () => {
  it('preserves full precision, explicit zero, negatives and values above 100%', () => {
    expect(
      cashFlowQualityMetrics({
        fcf: 1,
        revenue: 3,
        operatingCashFlow: 4,
        netIncome: 3,
      }),
    ).toEqual({ fcfMargin: (1 / 3) * 100, cashConversionRatio: (4 / 3) * 100 });
    expect(
      cashFlowQualityMetrics({
        fcf: -2,
        revenue: 10,
        operatingCashFlow: -3,
        netIncome: 2,
      }),
    ).toEqual({ fcfMargin: -20, cashConversionRatio: -150 });
    expect(
      cashFlowQualityMetrics({
        fcf: 0,
        revenue: 10,
        operatingCashFlow: 0,
        netIncome: 2,
      }),
    ).toEqual({ fcfMargin: 0, cashConversionRatio: 0 });
  });
  it.each([null, 0, -1, NaN, Infinity])(
    'returns null for missing, zero, negative or nonfinite denominators (%s)',
    (denominator) => {
      expect(
        cashFlowQualityMetrics({
          fcf: 10,
          revenue: denominator,
          operatingCashFlow: 20,
          netIncome: denominator,
        }),
      ).toEqual({ fcfMargin: null, cashConversionRatio: null });
    },
  );
  it.each([null, NaN, Infinity])(
    'returns null for invalid numerators without losing the other valid ratio (%s)',
    (numerator) => {
      expect(
        cashFlowQualityMetrics({
          fcf: numerator,
          revenue: 10,
          operatingCashFlow: 20,
          netIncome: 5,
        }),
      ).toEqual({ fcfMargin: null, cashConversionRatio: 400 });
      expect(
        cashFlowQualityMetrics({
          fcf: 10,
          revenue: 10,
          operatingCashFlow: numerator,
          netIncome: 5,
        }),
      ).toEqual({ fcfMargin: 100, cashConversionRatio: null });
    },
  );
});
it('uses independent Q2/Q3 YTD differences and Q4 annual-minus-nine-month amounts for both ratios', () => {
  const specifications = [
    ['Revenues', [90, 190, 300, 420]],
    ['NetIncomeLoss', [20, 45, 70, 100]],
    ['NetCashProvidedByUsedInOperatingActivities', [30, 80, 140, 200]],
    ['PaymentsToAcquirePropertyPlantAndEquipment', [4, 14, 24, 40]],
  ] as const;
  const facts = Object.fromEntries(
    specifications.map(([tag, values]) => [
      tag,
      {
        units: {
          USD: values.map((val, index) => ({
            val,
            start: '2025-01-01',
            end: ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'][
              index
            ],
            form: index === 3 ? '10-K' : '10-Q',
            fp: index === 3 ? 'FY' : `Q${index + 1}`,
            fy: 2025,
            filed: ['2025-05-01', '2025-08-01', '2025-11-01', '2026-02-01'][
              index
            ],
            accn: `0000000001-${index === 3 ? '26' : '25'}-00000${index + 1}`,
          })),
        },
      },
    ]),
  );
  const parsed = normalizeCompanyFacts({ cik: 1, facts: { 'us-gaap': facts } });
  const expected = [
    [1, 90, 20, 30, 4],
    [2, 100, 25, 50, 10],
    [3, 110, 25, 60, 10],
    [4, 120, 30, 60, 16],
  ];
  expect(parsed.quarterly).toHaveLength(4);
  for (const [q, revenue, ni, ocf, capex] of expected) {
    const row = parsed.quarterly.find((r) => r.fiscalQuarter === q)!;
    expect([
      row.revenue,
      row.netIncome,
      row.operatingCashFlow,
      row.capex,
    ]).toEqual([revenue, ni, ocf, capex]);
    expect(row.fcfMargin).toBe(((ocf - capex) / revenue) * 100);
    expect(row.cashConversionRatio).toBe((ocf / ni) * 100);
    if (q > 1)
      expect(row.sources.operatingCashFlow).toMatchObject({
        method: 'ytd_difference',
      });
  }
});
