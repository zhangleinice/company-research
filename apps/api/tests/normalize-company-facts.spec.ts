import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';

function observation(
  value: number,
  start: string | undefined,
  end: string,
  extra = {},
) {
  return {
    val: value,
    ...(start ? { start } : {}),
    end,
    fy: Number(end.slice(0, 4)),
    fp: 'FY',
    form: '10-K',
    filed: `${Number(end.slice(0, 4)) + 1}-02-15`,
    accn: `report-${end}`,
    ...extra,
  };
}
function fixture() {
  const units: Record<string, Record<string, unknown[]>> = {};
  const add = (tag: string, unit: string, value: unknown) => {
    ((units[tag] ??= {})[unit] ??= []).push(value);
  };
  for (let year = 2012; year <= 2025; year++) {
    const start = `${year}-01-01`,
      end = `${year}-12-31`;
    add(
      'Revenues',
      'USD',
      observation(100 * Math.pow(1.1, year - 2012), start, end),
    );
    add(
      'EarningsPerShareDiluted',
      'USD/shares',
      observation(year - 2010, start, end),
    );
    add('NetIncomeLoss', 'USD', observation(24, start, end));
    add('GrossProfit', 'USD', observation(60, start, end));
    add('OperatingIncomeLoss', 'USD', observation(35, start, end));
    add(
      'NetCashProvidedByUsedInOperatingActivities',
      'USD',
      observation(160, start, end),
    );
    add(
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'USD',
      observation(40, start, end),
    );
    add(
      'StockholdersEquity',
      'USD',
      observation(year === 2024 ? 100 : 140, undefined, end),
    );
    add('Assets', 'USD', observation(300, undefined, end));
    add(
      'CashAndCashEquivalentsAtCarryingValue',
      'USD',
      observation(50, undefined, end),
    );
    add('DebtCurrent', 'USD', observation(4, undefined, end));
    add('LongTermDebtNoncurrent', 'USD', observation(10, undefined, end));
  }
  for (const [quarter, end, quarterStart, revenue, cumulativeCash, capex] of [
    [1, '03-31', '01-01', 20, 20, 5],
    [2, '06-30', '04-01', 30, 60, 15],
    [3, '09-30', '07-01', 40, 90, 25],
  ] as const) {
    for (const year of [2024, 2025, 2026]) {
      const info = {
        fy: year,
        fp: `Q${quarter}`,
        form: '10-Q',
        filed: `${year}-${quarter === 1 ? '05-01' : quarter === 2 ? '08-01' : '11-01'}`,
        accn: `${year}-Q${quarter}`,
      };
      add(
        'Revenues',
        'USD',
        observation(
          revenue * (year - 2023),
          `${year}-${quarterStart}`,
          `${year}-${end}`,
          info,
        ),
      );
      add(
        'EarningsPerShareDiluted',
        'USD/shares',
        observation(quarter, `${year}-${quarterStart}`, `${year}-${end}`, info),
      );
      add(
        'NetCashProvidedByUsedInOperatingActivities',
        'USD',
        observation(cumulativeCash, `${year}-01-01`, `${year}-${end}`, info),
      );
      add(
        'PaymentsToAcquirePropertyPlantAndEquipment',
        'USD',
        observation(capex, `${year}-01-01`, `${year}-${end}`, info),
      );
    }
  }
  return {
    cik: 1652044,
    facts: {
      'us-gaap': Object.fromEntries(
        Object.entries(units).map(([tag, units]) => [tag, { units }]),
      ),
    },
  };
}

describe('Company Facts annual and independent-quarter normalization', () => {
  it('keeps ten annual and ten quarterly periods, latest first', () => {
    const result = normalizeCompanyFacts(fixture());
    expect(result.annual).toHaveLength(10);
    expect(result.quarterly).toHaveLength(10);
    expect(result.annual[0].periodEnd).toBe('2025-12-31');
    expect(result.quarterly[0]).toMatchObject({
      periodEnd: '2026-09-30',
      fiscalQuarter: 3,
      fiscalYear: 2026,
    });
  });
  it('subtracts YTD cash flow and capex to obtain independent Q2, Q3 and Q4', () => {
    const { quarterly } = normalizeCompanyFacts(fixture());
    expect(quarterly.find((x) => x.periodEnd === '2025-06-30')).toMatchObject({
      operatingCashFlow: 40,
      capex: 10,
      fcf: 30,
    });
    expect(quarterly.find((x) => x.periodEnd === '2025-09-30')).toMatchObject({
      operatingCashFlow: 30,
      capex: 10,
      fcf: 20,
    });
    expect(quarterly.find((x) => x.periodEnd === '2025-12-31')).toMatchObject({
      operatingCashFlow: 70,
      capex: 15,
      fcf: 55,
      eps: null,
    });
  });
  it('uses directly disclosed quarter EPS instead of subtracting cumulative EPS', () => {
    const { quarterly } = normalizeCompanyFacts(fixture());
    expect(quarterly.find((x) => x.periodEnd === '2025-06-30')?.eps).toBe(2);
    expect(quarterly.find((x) => x.periodEnd === '2025-12-31')?.eps).toBeNull();
  });
  it('calculates annual ROE from average equity and exposes calculation provenance', () => {
    const current = normalizeCompanyFacts(fixture()).annual[0];
    expect(current.roe).toBeCloseTo(20);
    expect(current.roa).toBeCloseTo(8);
    expect(current.totalDebt).toBe(14);
    expect(current.fcf).toBe(120);
    expect(current.sources.beginningEquity).toBeDefined();
  });
  it('calculates annual growth/CAGR and same-quarter YoY instead of sequential quarter growth', () => {
    const result = normalizeCompanyFacts(fixture());
    expect(result.annual[0].revenueGrowth).toBeCloseTo(10);
    expect(result.annual[0].revenueCagr3y).toBeCloseTo(10);
    expect(result.annual[0].revenueCagr5y).toBeCloseTo(10);
    expect(
      result.quarterly.find((x) => x.periodEnd === '2025-06-30')?.revenueGrowth,
    ).toBeCloseTo(100);
  });
  it('leaves missing raw fields and derived figures null, preserving genuine zero and losses', () => {
    const raw = {
      facts: {
        'us-gaap': {
          Revenues: {
            units: { USD: [observation(100, '2025-01-01', '2025-12-31')] },
          },
          NetIncomeLoss: {
            units: { USD: [observation(-5, '2025-01-01', '2025-12-31')] },
          },
          NetCashProvidedByUsedInOperatingActivities: {
            units: { USD: [observation(0, '2025-01-01', '2025-12-31')] },
          },
        },
      },
    };
    const row = normalizeCompanyFacts(raw).annual[0];
    expect(row.netMargin).toBe(-5);
    expect(row.operatingCashFlow).toBe(0);
    expect(row.capex).toBeNull();
    expect(row.fcf).toBeNull();
    expect(row.totalDebt).toBeNull();
    expect(row.roe).toBeNull();
  });
  it('does not treat non-USD monetary values as dollars or quarterly YTD as standalone', () => {
    const raw = {
      facts: {
        'us-gaap': {
          Revenues: {
            units: { EUR: [observation(100, '2025-01-01', '2025-12-31')] },
          },
        },
      },
    };
    expect(normalizeCompanyFacts(raw)).toEqual({ annual: [], quarterly: [] });
    const cashOnly = {
      facts: {
        'us-gaap': {
          NetCashProvidedByUsedInOperatingActivities: {
            units: {
              USD: [
                observation(99, '2025-01-01', '2025-06-30', {
                  form: '10-Q',
                  fp: 'Q2',
                  filed: '2025-08-01',
                }),
              ],
            },
          },
        },
      },
    };
    expect(normalizeCompanyFacts(cashOnly).quarterly).toHaveLength(0);
  });
  it('selects the latest amended value for identical concept/unit/period', () => {
    const data = fixture();
    data.facts['us-gaap'].NetIncomeLoss.units.USD.push(
      observation(30, '2025-01-01', '2025-12-31', {
        form: '10-K/A',
        filed: '2026-04-01',
        accn: 'amendment',
      }),
    );
    const row = normalizeCompanyFacts(data).annual[0];
    expect(row.netIncome).toBe(30);
    expect(row.fiscalYear).toBe(2025);
  });
});

describe('CapEx and FCF missing-data safeguards', () => {
  it('does not substitute older CapEx for the latest annual period', () => {
    const data = fixture();
    data.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD =
      data.facts[
        'us-gaap'
      ].PaymentsToAcquirePropertyPlantAndEquipment.units.USD.filter(
        (value: unknown) =>
          !(
            typeof value === 'object' &&
            value !== null &&
            'start' in value &&
            value.start === '2025-01-01' &&
            'end' in value &&
            value.end === '2025-12-31'
          ),
      );
    const row = normalizeCompanyFacts(data).annual[0];
    expect(row.operatingCashFlow).toBe(160);
    expect(row.capex).toBeNull();
    expect(row.fcf).toBeNull();
    expect(row.fcfMargin).toBeNull();
  });
  it('does not use six-month YTD CapEx as Q2 when the Q1 endpoint is unavailable', () => {
    const data = fixture();
    data.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD =
      data.facts[
        'us-gaap'
      ].PaymentsToAcquirePropertyPlantAndEquipment.units.USD.filter(
        (value: unknown) =>
          !(
            typeof value === 'object' &&
            value !== null &&
            'end' in value &&
            value.end === '2025-03-31'
          ),
      );
    const row = normalizeCompanyFacts(data).quarterly.find(
      (row) => row.periodEnd === '2025-06-30',
    )!;
    expect(row.operatingCashFlow).toBe(40);
    expect(row.capex).toBeNull();
    expect(row.fcf).toBeNull();
  });
});
