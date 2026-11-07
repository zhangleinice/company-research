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

describe('Growth concept reconciliation and exact CAGR spans', () => {
  function transition(conflict = false) {
    const years = [2020, 2021, 2022, 2023, 2024, 2025];
    const revenues = [182527, 257637, 282836, 307394, 350018, 402836];
    const eps = [2.93, 5.61, 4.56, 5.8, 8.04, 10.81];
    const obs = (index: number, val: number) =>
      observation(val, `${years[index]}-01-01`, `${years[index]}-12-31`);
    return {
      facts: {
        'us-gaap': {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: revenues
                .slice(0, 5)
                .map((val, index) => obs(index, val * 1e6)),
            },
          },
          Revenues: {
            units: {
              USD: revenues
                .slice(3)
                .map((val, index) =>
                  obs(
                    index + 3,
                    (val + (conflict && index === 0 ? 1 : 0)) * 1e6,
                  ),
                ),
            },
          },
          EarningsPerShareDiluted: {
            units: { 'USD/shares': eps.map((val, index) => obs(index, val)) },
          },
        },
      },
    };
  }
  it('reconciles an evidenced revenue tag transition using disclosed Alphabet values', () => {
    // Values checked against issuer 10-K statements; concept transition is a synthetic regression fixture.
    const row = normalizeCompanyFacts(transition()).annual[0];
    expect(row.revenue).toBe(402836e6);
    expect(row.revenueGrowth).toBeCloseTo((402836 / 350018 - 1) * 100);
    expect(row.revenueCagr3y).toBeCloseTo(
      (Math.pow(402836 / 282836, 1 / 3) - 1) * 100,
    );
    expect(row.revenueCagr5y).toBeCloseTo(
      (Math.pow(402836 / 182527, 1 / 5) - 1) * 100,
    );
    expect(row.epsGrowth).toBeCloseTo((10.81 / 8.04 - 1) * 100);
    expect(row.epsCagr3y).toBeCloseTo(
      (Math.pow(10.81 / 4.56, 1 / 3) - 1) * 100,
    );
    expect(row.epsCagr5y).toBeCloseTo(
      (Math.pow(10.81 / 2.93, 1 / 5) - 1) * 100,
    );
  });
  it('rejects tag transitions with conflicting overlap rather than treating all revenue tags as interchangeable', () => {
    const row = normalizeCompanyFacts(transition(true)).annual[0];
    expect(row.revenueGrowth).toBeNull();
    expect(row.revenueCagr3y).toBeNull();
  });
  it('uses an exact three-year endpoint even when an intermediate year is missing', () => {
    const raw = transition();
    for (const fact of Object.values(raw.facts['us-gaap']))
      for (const values of Object.values(fact.units)) {
        for (let i = values.length - 1; i >= 0; i--)
          if (values[i].end === '2021-12-31') values.splice(i, 1);
      }
    const row = normalizeCompanyFacts(raw).annual[0];
    expect(row.revenueCagr3y).toBeCloseTo(
      (Math.pow(402836 / 282836, 1 / 3) - 1) * 100,
    );
    expect(row.revenueCagr5y).toBeCloseTo(
      (Math.pow(402836 / 182527, 1 / 5) - 1) * 100,
    );
  });
});

describe('profitability: matched cost-of-revenue fallback and average balances', () => {
  function profitabilityFixture() {
    const fact = (value: number, start: string | undefined, end: string) =>
      observation(value, start, end, {
        filed: '2026-02-05',
        accn: 'alphabet-2025',
      });
    const tag = (...rows: unknown[]) => ({ units: { USD: rows } });
    return {
      facts: {
        'us-gaap': {
          Revenues: tag(fact(402836e6, '2025-01-01', '2025-12-31')),
          CostOfRevenue: tag(fact(162535e6, '2025-01-01', '2025-12-31')),
          GrossProfit: tag(),
          OperatingIncomeLoss: tag(fact(129039e6, '2025-01-01', '2025-12-31')),
          NetIncomeLoss: tag(fact(132170e6, '2025-01-01', '2025-12-31')),
          StockholdersEquity: tag(
            fact(325084e6, undefined, '2024-12-31'),
            fact(415265e6, undefined, '2025-12-31'),
          ),
          Assets: tag(
            fact(450256e6, undefined, '2024-12-31'),
            fact(595281e6, undefined, '2025-12-31'),
          ),
        },
      },
    };
  }
  it('reproduces Alphabet disclosed 2025 totals and deterministic profitability calculations', () => {
    const row = normalizeCompanyFacts(profitabilityFixture()).annual[0];
    expect(row.grossProfit).toBe(240301e6);
    expect(row.grossMargin).toBeCloseTo((240301 / 402836) * 100);
    expect(row.operatingMargin).toBeCloseTo((129039 / 402836) * 100);
    expect(row.netMargin).toBeCloseTo((132170 / 402836) * 100);
    expect(row.netMargin!).toBeGreaterThan(row.operatingMargin!);
    expect(row.roe).toBeCloseTo((132170 / ((325084 + 415265) / 2)) * 100);
    expect(row.roa).toBeCloseTo((132170 / ((450256 + 595281) / 2)) * 100);
    expect(row.sources.grossProfit).toMatchObject({
      formula: 'revenue-costOfRevenue',
    });
    expect(row.sources.roe).toBeDefined();
    expect(row.sources.roa).toBeDefined();
  });
  it.each(['AAPL', 'NVDA'])(
    '%s: prefers directly reported gross profit over fallback (synthetic)',
    () => {
      const raw = profitabilityFixture();
      raw.facts['us-gaap'].GrossProfit.units.USD.push(
        observation(250000e6, '2025-01-01', '2025-12-31', {
          filed: '2026-02-05',
          accn: 'alphabet-2025',
        }),
      );
      expect(normalizeCompanyFacts(raw).annual[0].grossProfit).toBe(250000e6);
    },
  );
  it.each(['accn', 'start', 'end', 'unit', 'missing'])(
    'rejects mismatched or missing cost %s',
    (field) => {
      const raw = profitabilityFixture();
      const cost = raw.facts['us-gaap'].CostOfRevenue;
      const original = cost.units.USD[0] as Record<string, unknown>;
      if (field === 'missing') cost.units.USD = [];
      else if (field === 'unit')
        (cost.units as Record<string, unknown[]>).EUR =
          cost.units.USD.splice(0);
      else original[field] = field === 'accn' ? 'other-filing' : '2024-01-01';
      expect(normalizeCompanyFacts(raw).annual[0].grossProfit).toBeNull();
      expect(normalizeCompanyFacts(raw).annual[0].grossMargin).toBeNull();
    },
  );
  it('preserves zero cost and negative gross profit; never substitutes total operating expenses', () => {
    const raw = profitabilityFixture();
    const cost = raw.facts['us-gaap'].CostOfRevenue.units.USD[0] as Record<
      string,
      unknown
    >;
    cost.val = 0;
    expect(normalizeCompanyFacts(raw).annual[0].grossMargin).toBe(100);
    cost.val = 500000e6;
    expect(normalizeCompanyFacts(raw).annual[0].grossMargin).toBeLessThan(0);
    raw.facts['us-gaap'].CostOfRevenue.units.USD = [];
    expect(normalizeCompanyFacts(raw).annual[0].grossProfit).toBeNull();
  });
  it('does not mix parent profit with equity including noncontrolling interests', () => {
    const raw = profitabilityFixture();
    const taxonomy = raw.facts['us-gaap'] as Record<
      string,
      { units: { USD: unknown[] } }
    >;
    taxonomy.StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest =
      taxonomy.StockholdersEquity;
    delete taxonomy.StockholdersEquity;
    expect(normalizeCompanyFacts(raw).annual[0].roe).toBeNull();
  });
  it('does not use a missing or nonpositive beginning equity in ROE', () => {
    const raw = profitabilityFixture();
    (
      raw.facts['us-gaap'].StockholdersEquity.units.USD[0] as Record<
        string,
        unknown
      >
    ).val = 0;
    expect(normalizeCompanyFacts(raw).annual[0].roe).toBeNull();
  });
  it('derives independent Q2 gross profit from matched YTD endpoints and rejects missing Q1 costs', () => {
    const raw = profitabilityFixture();
    const taxonomy = raw.facts['us-gaap'];
    for (const [end, revenue, cost, fp] of [
      ['2025-03-31', 100, 40, 'Q1'],
      ['2025-06-30', 230, 100, 'Q2'],
    ] as const) {
      const extra = {
        form: '10-Q',
        fp,
        filed: '2025-08-01',
        accn: 'q2-report',
      };
      taxonomy.Revenues.units.USD.push(
        observation(revenue, '2025-01-01', end, extra),
      );
      taxonomy.CostOfRevenue.units.USD.push(
        observation(cost, '2025-01-01', end, extra),
      );
    }
    const row = normalizeCompanyFacts(raw).quarterly.find(
      (x) => x.periodEnd === '2025-06-30',
    )!;
    expect(row).toMatchObject({
      revenue: 130,
      grossProfit: 70,
      roe: null,
      roa: null,
    });
    expect(row.grossMargin).toBeCloseTo((70 / 130) * 100);
    taxonomy.CostOfRevenue.units.USD.splice(1, 1);
    expect(
      normalizeCompanyFacts(raw).quarterly.find(
        (x) => x.periodEnd === '2025-06-30',
      )?.grossProfit,
    ).toBeNull();
  });
});

describe('cash flow: audited definitions, independent quarters and missing inputs', () => {
  it('selects the latest annual cash-flow amendment without changing its actual period', () => {
    const raw = fixture();
    raw.facts[
      'us-gaap'
    ].NetCashProvidedByUsedInOperatingActivities.units.USD.push(
      observation(170, '2025-01-01', '2025-12-31', {
        form: '10-K/A',
        filed: '2026-03-01',
        accn: 'cash-amendment',
      }),
    );
    const row = normalizeCompanyFacts(raw).annual[0];
    expect(row).toMatchObject({
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      operatingCashFlow: 170,
      capex: 40,
      fcf: 130,
    });
    expect(row.sources.operatingCashFlow).toMatchObject({
      items: [expect.objectContaining({ accn: 'cash-amendment' })],
    });
  });
  it('preserves negative operating/free cash flow and leaves the CapEx/OCF ratio null', () => {
    const raw = fixture();
    const values = raw.facts['us-gaap']
      .NetCashProvidedByUsedInOperatingActivities.units.USD as {
      end: string;
      start: string;
      val: number;
    }[];
    const annual = values.find(
      (x) => x.start === '2025-01-01' && x.end === '2025-12-31',
    )!;
    annual.val = -10;
    expect(normalizeCompanyFacts(raw).annual[0]).toMatchObject({
      operatingCashFlow: -10,
      fcf: -50,
      capexToOcf: null,
    });
  });

  it('reconciles Alphabet 2025/2024 cash figures and calculates comparable annual FCF YoY (disclosure fixture)', () => {
    const data: Record<string, { units: { USD: unknown[] } }> = {};
    const add = (tag: string, year: number, value: number) => {
      (data[tag] ??= { units: { USD: [] } }).units.USD.push(
        observation(value * 1e6, `${year}-01-01`, `${year}-12-31`, {
          filed: '2026-02-05',
          accn: '0001652044-26-000018',
        }),
      );
    };
    for (const [year, revenue, ocf, capex, ni, buybacks, dividends] of [
      [2024, 350018, 125299, 52535, 100118, 62222, 7363],
      [2025, 402836, 164713, 91447, 132170, 45709, 10049],
    ]) {
      for (const [tag, value] of [
        ['Revenues', revenue],
        ['NetCashProvidedByUsedInOperatingActivities', ocf],
        ['PaymentsToAcquirePropertyPlantAndEquipment', capex],
        ['NetIncomeLoss', ni],
        ['PaymentsForRepurchaseOfCommonStock', buybacks],
        ['PaymentsOfDividends', dividends],
      ] as const)
        add(tag, year, value);
    }
    // Unrelated investing or noncash values must never be treated as CapEx.
    add('NetCashProvidedByUsedInInvestingActivities', 2025, -120291);
    add('CapitalExpendituresIncurredButNotYetPaid', 2025, 15090);
    const row = normalizeCompanyFacts({ facts: { 'us-gaap': data } }).annual[0];
    expect(row).toMatchObject({
      operatingCashFlow: 164713e6,
      capex: 91447e6,
      fcf: 73266e6,
      netIncome: 132170e6,
      stockRepurchases: 45709e6,
      dividendsPaid: 10049e6,
    });
    expect(row.fcfMargin).toBeCloseTo((73266 / 402836) * 100);
    expect(row.fcfGrowth).toBeCloseTo((73266 / 72764 - 1) * 100);
    expect(row.capexToOcf).toBeCloseTo((91447 / 164713) * 100);
  });
  it('reconstructs Q4 from annual minus nine months and keeps its ratio and provenance aligned', () => {
    const row = normalizeCompanyFacts(fixture()).quarterly.find(
      (x) => x.periodEnd === '2025-12-31',
    )!;
    expect(row).toMatchObject({
      periodStart: '2025-10-01',
      operatingCashFlow: 70,
      capex: 15,
      fcf: 55,
    });
    expect(row.capexToOcf).toBeCloseTo((15 / 70) * 100);
    expect(row.sources.operatingCashFlow).toMatchObject({
      method: 'ytd_difference',
    });
    expect(row.sources.capex).toMatchObject({ method: 'ytd_difference' });
  });
  it('cannot reconstruct Q4 CapEx/FCF from annual CapEx without nine-month CapEx', () => {
    const raw = fixture();
    const values = raw.facts['us-gaap']
      .PaymentsToAcquirePropertyPlantAndEquipment.units.USD as {
      end: string;
    }[];
    raw.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment.units.USD =
      values.filter((x) => x.end !== '2025-09-30');
    const row = normalizeCompanyFacts(raw).quarterly.find(
      (x) => x.periodEnd === '2025-12-31',
    )!;
    expect(row.operatingCashFlow).toBe(70);
    expect(row.capex).toBeNull();
    expect(row.fcf).toBeNull();
    expect(row.capexToOcf).toBeNull();
  });
  it('prefers a directly reported quarter to YTD differences and compares FCF to last year same quarter', () => {
    const raw = fixture();
    const data = raw.facts['us-gaap'];
    for (const year of [2024, 2025]) {
      const info = {
        fp: 'Q2',
        form: '10-Q',
        filed: `${year}-08-02`,
        accn: `${year}-direct`,
      };
      data.NetCashProvidedByUsedInOperatingActivities.units.USD.push(
        observation(
          year === 2025 ? 60 : 40,
          `${year}-04-01`,
          `${year}-06-30`,
          info,
        ),
      );
      data.PaymentsToAcquirePropertyPlantAndEquipment.units.USD.push(
        observation(10, `${year}-04-01`, `${year}-06-30`, info),
      );
    }
    const row = normalizeCompanyFacts(raw).quarterly.find(
      (x) => x.periodEnd === '2025-06-30',
    )!;
    expect(row.operatingCashFlow).toBe(60);
    expect(row.fcf).toBe(50);
    expect(row.fcfGrowth).toBeCloseTo((50 / 30 - 1) * 100);
    expect(row.sources.operatingCashFlow).toMatchObject({ method: 'reported' });
  });
  it.each(['AAPL', 'NVDA'])(
    '%s: cash flow normalizes a non-calendar fiscal year and Q4 (synthetic)',
    () => {
      const raw = fixture();
      // Shift each observation 31 days: anchors and differences must follow actual dates, not calendar Q4.
      for (const tag of Object.values(raw.facts['us-gaap']))
        for (const values of Object.values(tag.units))
          for (const value of values as {
            start?: string;
            end: string;
            filed: string;
          }[]) {
            const shift = (date: string) =>
              new Date(Date.parse(date) + 31 * 86400000)
                .toISOString()
                .slice(0, 10);
            if (value.start) value.start = shift(value.start);
            value.end = shift(value.end);
            value.filed = shift(value.filed);
          }
      const row = normalizeCompanyFacts(raw).quarterly.find(
        (x) => x.periodEnd === '2026-01-31',
      )!;
      expect(row).toMatchObject({
        fiscalQuarter: 4,
        operatingCashFlow: 70,
        capex: 15,
        fcf: 55,
      });
    },
  );
});
