import {
  FINANCIAL_METRICS,
  type FinancialPeriod,
} from '@company-research/shared';
import { annualCapitalAllocation } from '../src/modules/financials/capital-allocation';

const cik = '0000000001';
function fixture() {
  const row = {
    ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, null])),
    fiscalYear: 2025,
    fiscalQuarter: null,
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    currency: 'USD',
    dividendsPaid: 20,
    netIncome: 100,
    stockRepurchases: 80,
    operatingCashFlow: 100,
    capex: 50,
    fcf: 50,
    sharesOutstanding: 10,
  } as FinancialPeriod;
  const fact = (concept: string, val: number, instant = false) => ({
    method: 'reported',
    items: [
      {
        concept: `us-gaap:${concept}`,
        val,
        unit: instant ? 'shares' : 'USD',
        ...(instant ? {} : { start: row.periodStart }),
        end: row.periodEnd,
        accn: '0000000001-26-000001',
        filed: '2026-02-01',
        form: '10-K',
      },
    ],
  });
  const sources = {
    dividendsPaid: fact('PaymentsOfDividendsCommonStock', 20),
    netIncome: fact('NetIncomeLossAvailableToCommonStockholdersBasic', 100),
    stockRepurchases: fact('PaymentsForRepurchaseOfCommonStock', 80),
    operatingCashFlow: fact('NetCashProvidedByUsedInOperatingActivities', 100),
    capex: fact('PaymentsToAcquirePropertyPlantAndEquipment', 50),
    sharesOutstanding: fact('CommonStockSharesOutstanding', 10, true),
  };
  return { row, sources };
}
it('calculates only annual matching common-stock payout and positive FCF; keeps >100%', () => {
  const { row, sources } = fixture();
  const result = annualCapitalAllocation(row, sources, cik);
  expect(result.payoutRatio.value).toBe(20);
  expect(result.buybackToFcf.value).toBe(160);
  expect(result.dividendsPaid.scope).toBe('common');
  expect(result.sharesOutstanding.value).toBe(10);
  expect(result.payoutRatio.sources).toHaveLength(2);
  expect(result.buybackToFcf.sources).toHaveLength(3);
  expect(result.payoutRatio.sources[0].url).toContain('/1/000000000126000001/');
});
it('displays broad dividend payments but never treats them as common dividends', () => {
  const { row, sources } = fixture();
  sources.dividendsPaid.items[0].concept = 'us-gaap:PaymentsOfDividends';
  const result = annualCapitalAllocation(row, sources, cik);
  expect(result.dividendsPaid.value).toBe(20);
  expect(result.dividendsPaid.scope).toBe('total');
  expect(result.payoutRatio.value).toBeNull();
});
it('does not assume NetIncomeLoss or ProfitLoss belongs to ordinary shareholders', () => {
  for (const tag of ['NetIncomeLoss', 'ProfitLoss']) {
    const { row, sources } = fixture();
    sources.netIncome.items[0].concept = `us-gaap:${tag}`;
    expect(
      annualCapitalAllocation(row, sources, cik).payoutRatio.value,
    ).toBeNull();
  }
});
it.each([0, -10, null])('does not calculate with FCF %s', (value) => {
  const { row, sources } = fixture();
  row.fcf = value;
  if (value !== null) {
    row.capex = 100 - value;
    sources.capex.items[0].val = row.capex;
  }
  const result = annualCapitalAllocation(row, sources, cik);
  expect(result.buybackToFcf.value).toBeNull();
  expect(result.buybackToFcf.reason).toBeTruthy();
});
it.each([0, -5, null])(
  'requires positive ordinary-shareholder income %s',
  (value) => {
    const { row, sources } = fixture();
    row.netIncome = value;
    if (value !== null) sources.netIncome.items[0].val = value;
    expect(
      annualCapitalAllocation(row, sources, cik).payoutRatio.value,
    ).toBeNull();
  },
);
it('preserves genuine zero dividends and repurchases without filling missing data', () => {
  const { row, sources } = fixture();
  row.dividendsPaid = sources.dividendsPaid.items[0].val = 0;
  row.stockRepurchases = sources.stockRepurchases.items[0].val = 0;
  const result = annualCapitalAllocation(row, sources, cik);
  expect(result.payoutRatio.value).toBe(0);
  expect(result.buybackToFcf.value).toBe(0);
  expect(annualCapitalAllocation(row, {}, cik).buybackToFcf.value).toBeNull();
});
it('rejects mismatched periods, units, contradictory cached values and cumulative sources', () => {
  for (const mutate of [
    (x: ReturnType<typeof fixture>) => {
      x.sources.dividendsPaid.items[0].start = '2024-01-01';
    },
    (x: ReturnType<typeof fixture>) => {
      x.sources.dividendsPaid.items[0].unit = 'shares';
    },
    (x: ReturnType<typeof fixture>) => {
      x.sources.dividendsPaid.items[0].val = 999;
    },
    (x: ReturnType<typeof fixture>) => {
      x.sources.dividendsPaid.method = 'ytd_difference';
    },
    (x: ReturnType<typeof fixture>) => {
      x.row.fiscalQuarter = 4;
    },
  ]) {
    const x = fixture();
    mutate(x);
    expect(
      annualCapitalAllocation(x.row, x.sources, cik).payoutRatio.value,
    ).toBeNull();
  }
  const x = fixture();
  x.row.fcf = 999;
  expect(
    annualCapitalAllocation(x.row, x.sources, cik).buybackToFcf.value,
  ).toBeNull();
});
it('requires period-end entity-wide shares, not weighted or cover-date shares', () => {
  for (const mutation of [
    { end: '2026-01-20' },
    { start: '2025-01-01' },
    { concept: 'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding' },
    { dimensions: { axis: 'classA' } },
  ]) {
    const x = fixture();
    Object.assign(x.sources.sharesOutstanding.items[0], mutation);
    expect(
      annualCapitalAllocation(x.row, x.sources, cik).sharesOutstanding.value,
    ).toBeNull();
  }
});
it('does not mutate financial values or provenance', () => {
  const x = fixture(),
    before = JSON.stringify(x);
  annualCapitalAllocation(x.row, x.sources, cik);
  expect(JSON.stringify(x)).toBe(before);
});
it('accepts actual GOOGL FY2025 cache periods, including the later filing comparative year-end share fact', () => {
  const { row, sources } = fixture();
  Object.assign(row, {
    sharesOutstanding: 12088000000,
    stockRepurchases: 45709000000,
    operatingCashFlow: 164713000000,
    capex: 91447000000,
    fcf: 73266000000,
    dividendsPaid: 10049000000,
    netIncome: 132170000000,
  });
  for (const key of Object.keys(sources) as (keyof typeof sources)[]) {
    Object.assign(sources[key].items[0], {
      val: row[key],
      accn: '0001652044-26-000018',
      filed: '2026-02-05',
    });
  }
  sources.dividendsPaid.items[0].concept = 'us-gaap:PaymentsOfDividends';
  sources.netIncome.items[0].concept = 'us-gaap:NetIncomeLoss';
  Object.assign(sources.sharesOutstanding.items[0], {
    accn: '0001652044-26-000084',
    filed: '2026-10-29',
    form: '10-Q',
    fy: 2026,
    fp: 'Q3',
  });
  const result = annualCapitalAllocation(row, sources, '0001652044');
  expect(result.sharesOutstanding.value).toBe(12088000000);
  expect(result.sharesOutstanding.sources[0].end).toBe('2025-12-31');
  expect(result.buybackToFcf.value).toBeCloseTo(62.387737832);
  expect(result.payoutRatio.value).toBeNull();
  sources.stockRepurchases.items[0].start = '2024-01-01';
  expect(
    annualCapitalAllocation(row, sources, '0001652044').buybackToFcf.value,
  ).toBeNull();
});
it('rejects duplicate class facts instead of summing A/B/C or mixing them with total shares', () => {
  const { row, sources } = fixture();
  sources.sharesOutstanding.items.push({
    ...sources.sharesOutstanding.items[0],
    val: 5,
  });
  expect(
    annualCapitalAllocation(row, sources, cik).sharesOutstanding.value,
  ).toBeNull();
});
it('derives reinvestment ratios only from verified matching full-year sources, without guessing missing revenue', () => {
  const { row, sources } = fixture();
  row.revenue = 200;
  const provenance = {
    ...sources,
    revenue: {
      ...sources.operatingCashFlow,
      items: [
        {
          ...sources.operatingCashFlow.items[0],
          concept: 'us-gaap:Revenues',
          val: 200,
        },
      ],
    },
  };
  const result = annualCapitalAllocation(row, provenance, cik).reinvestment!;
  expect(result.capex.value).toBe(50);
  expect(result.capexToOcf.value).toBe(50);
  expect(result.capexToRevenue.value).toBe(25);
  row.revenue = 0;
  provenance.revenue.items[0].val = 0;
  expect(
    annualCapitalAllocation(row, provenance, cik).reinvestment!.capexToRevenue
      .value,
  ).toBeNull();
  row.revenue = 200;
  provenance.revenue.items[0].val = 200;
  provenance.revenue.items[0].start = '2024-01-01';
  expect(
    annualCapitalAllocation(row, provenance, cik).reinvestment!.capexToRevenue
      .value,
  ).toBeNull();
  expect(
    annualCapitalAllocation(row, {}, cik).reinvestment!.capex.value,
  ).toBeNull();
});
