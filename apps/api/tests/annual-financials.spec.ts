import { summarizeAnnualFacts } from '../src/modules/financials/annual-financials';

function observation(
  val: number,
  start = '2025-01-01',
  end = '2025-12-31',
  overrides = {},
) {
  return {
    val,
    start,
    end,
    fy: 2025,
    fp: 'FY',
    form: '10-K',
    filed: '2026-02-01',
    accn: 'annual-2025',
    ...overrides,
  };
}
function facts(entries: Record<string, unknown[]>) {
  return {
    facts: {
      'us-gaap': Object.fromEntries(
        Object.entries(entries).map(([tag, USD]) => [tag, { units: { USD } }]),
      ),
    },
  };
}

describe('annual financial normalization', () => {
  it('computes metrics from aligned annual periods and retains auditable sources', () => {
    const result = summarizeAnnualFacts(
      facts({
        RevenueFromContractWithCustomerExcludingAssessedTax: [
          observation(120),
          observation(100, '2024-01-01', '2024-12-31'),
        ],
        NetIncomeLoss: [observation(24)],
        NetCashProvidedByUsedInOperatingActivities: [observation(40)],
        PaymentsToAcquirePropertyPlantAndEquipment: [observation(10)],
      }),
    );
    expect(result).toMatchObject({
      fiscalYear: 2025,
      periodEnd: '2025-12-31',
      currency: 'USD',
      revenue: 120,
      netIncome: 24,
      netMargin: 20,
      operatingCashFlow: 40,
      capitalExpenditure: 10,
      freeCashFlow: 30,
    });
    expect(result.revenueGrowth).toBeCloseTo(20);
    expect(result.sources.revenue).toMatchObject({
      tag: 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
      start: '2025-01-01',
      end: '2025-12-31',
      accession: 'annual-2025',
    });
  });
  it('selects by observation dates rather than the fy attached to historical comparatives', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [
          observation(20, '2024-01-01', '2024-12-31', { fy: 2025 }),
          observation(30),
          observation(999, '2026-01-01', '2026-03-31', {
            fy: 2026,
            fp: 'Q1',
            form: '10-Q',
            filed: '2026-05-01',
          }),
        ],
      }),
    );
    expect(result.periodEnd).toBe('2025-12-31');
    expect(result.revenue).toBe(30);
  });
  it('uses the fiscal-year label from the original filing, values from the latest restatement', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [
          observation(100),
          observation(110, '2025-01-01', '2025-12-31', {
            filed: '2027-03-01',
            fy: 2026,
            accn: 'restated',
            form: '10-K/A',
          }),
        ],
      }),
    );
    expect(result.fiscalYear).toBe(2025);
    expect(result.revenue).toBe(110);
    expect(result.sources.revenue?.accession).toBe('restated');
  });
  it('does not fill missing latest-year revenue with older-year revenue', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [observation(100, '2024-01-01', '2024-12-31')],
        NetIncomeLoss: [observation(10)],
      }),
    );
    expect(result.periodEnd).toBe('2025-12-31');
    expect(result.revenue).toBeNull();
    expect(result.netMargin).toBeNull();
  });
  it('preserves losses and genuine zero values', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [observation(100)],
        NetIncomeLoss: [observation(-10)],
        NetCashProvidedByUsedInOperatingActivities: [observation(0)],
        PaymentsToAcquirePropertyPlantAndEquipment: [observation(0)],
      }),
    );
    expect(result.netMargin).toBe(-10);
    expect(result.operatingCashFlow).toBe(0);
    expect(result.freeCashFlow).toBe(0);
  });
  it.each([0, -100])(
    'does not calculate revenue growth against baseline %s',
    (baseline) => {
      const result = summarizeAnnualFacts(
        facts({
          Revenues: [
            observation(120),
            observation(baseline, '2024-01-01', '2024-12-31'),
          ],
        }),
      );
      expect(result.revenueGrowth).toBeNull();
    },
  );
  it('does not compare nonadjacent years or different revenue tags', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [
          observation(120),
          observation(80, '2023-01-01', '2023-12-31'),
        ],
        SalesRevenueNet: [observation(100, '2024-01-01', '2024-12-31')],
      }),
    );
    expect(result.revenueGrowth).toBeNull();
  });
  it('does not silently normalize negative capex or misaligned periods', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [observation(100)],
        PaymentsToAcquirePropertyPlantAndEquipment: [observation(-10)],
        NetIncomeLoss: [observation(10, '2025-01-02', '2025-12-31')],
      }),
    );
    expect(result.capitalExpenditure).toBeNull();
    expect(result.freeCashFlow).toBeNull();
    expect(result.netIncome).toBeNull();
  });
  it('supports 53-week fiscal years', () => {
    const result = summarizeAnnualFacts(
      facts({
        Revenues: [
          observation(100, '2024-12-29', '2026-01-03', { filed: '2026-02-01' }),
        ],
      }),
    );
    expect(result.revenue).toBe(100);
  });
  it('leaves unsupported currencies and taxonomies null', () => {
    const result = summarizeAnnualFacts({
      facts: {
        'us-gaap': { Revenues: { units: { EUR: [observation(100)] } } },
        'ifrs-full': { Revenue: { units: { USD: [observation(100)] } } },
      },
    });
    expect(result.revenue).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.fiscalYear).toBeNull();
  });
});
