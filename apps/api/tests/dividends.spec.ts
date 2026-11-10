import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
const fact = (start: string, end: string, val: number, extra = {}) => ({
  start,
  end,
  val,
  accn: 'report',
  filed: '2026-02-05',
  form: '10-K',
  fp: 'FY',
  ...extra,
});
function facts() {
  return {
    cik: 1652044,
    facts: {
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              fact('2023-01-01', '2023-12-31', 100),
              fact('2024-01-01', '2024-12-31', 100),
              fact('2025-01-01', '2025-12-31', 100),
              fact('2025-01-01', '2025-03-31', 25),
              fact('2025-04-01', '2025-06-30', 25),
              fact('2025-07-01', '2025-09-30', 25),
              fact('2024-04-01', '2024-06-30', 25),
            ],
          },
        },
        CommonStockDividendsPerShareDeclared: {
          units: {
            'USD/shares': [
              fact('2024-01-01', '2024-12-31', 0.6),
              fact('2025-01-01', '2025-12-31', 0.83),
              fact('2025-01-01', '2025-03-31', 0.2),
              fact('2025-04-01', '2025-06-30', 0.21),
              fact('2025-01-01', '2025-06-30', 0.41),
              fact('2024-04-01', '2024-06-30', 0.2),
            ],
          },
        },
        PaymentsOfDividends: {
          units: { USD: [fact('2025-01-01', '2025-12-31', 10000000)] },
        },
        PreferredStockDividendsPerShareDeclared: {
          units: { 'USD/shares': [fact('2025-01-01', '2025-12-31', 12.15)] },
        },
      },
    },
  };
}
it('GOOGL declared ordinary DPS differs from dividends paid and preferred DPS', () => {
  const result = normalizeCompanyFacts(facts());
  expect(result.annual[0].dividendsPerShare).toBe(0.83);
  expect(result.annual[0].dpsGrowth).toBeCloseTo(38.33333333);
  expect(result.annual[0].dividendsPaid).toBe(10000000);
  expect(
    result.annual.find((x) => x.periodEnd === '2024-12-31')?.dpsGrowth,
  ).toBeNull();
  expect(
    result.annual.find((x) => x.periodEnd === '2023-12-31')?.dividendsPerShare,
  ).toBeNull();
});
it('GOOGL quarterly DPS uses direct quarter amounts, never cumulative or annual amounts', () => {
  const result = normalizeCompanyFacts(facts());
  const q2 = result.quarterly.find((x) => x.periodEnd === '2025-06-30');
  expect(q2?.dividendsPerShare).toBe(0.21);
  expect(q2?.dpsGrowth).toBeCloseTo(5);
  expect(
    result.quarterly.find((x) => x.periodEnd === '2025-12-31')
      ?.dividendsPerShare,
  ).toBeNull();
});
it('GOOGL missing DPS stays null after first dividend and wrong units cannot fill it', () => {
  const raw = facts();
  raw.facts['us-gaap'].CommonStockDividendsPerShareDeclared.units[
    'USD/shares'
  ] = [];
  const result = normalizeCompanyFacts(raw);
  expect(result.annual[0].dividendsPerShare).toBeNull();
  expect(result.annual[0].dpsGrowth).toBeNull();
  expect(
    result.annual.find((x) => x.periodEnd === '2023-12-31')?.sources
      .dividendsPerShare,
  ).toBeUndefined();
});
it('GOOGL repeated filings prefer the latest valid declared amount and reject negative DPS', () => {
  const raw = facts();
  raw.facts['us-gaap'].CommonStockDividendsPerShareDeclared.units[
    'USD/shares'
  ].push(fact('2025-01-01', '2025-12-31', 9, { filed: '2026-01-01' }));
  expect(normalizeCompanyFacts(raw).annual[0].dividendsPerShare).toBe(0.83);
  raw.facts['us-gaap'].CommonStockDividendsPerShareDeclared.units[
    'USD/shares'
  ].push(fact('2025-01-01', '2025-12-31', -1, { filed: '2026-02-06' }));
  expect(normalizeCompanyFacts(raw).annual[0].dividendsPerShare).toBeNull();
});

it('preserves an explicitly reported zero and prefers common-stock cash payments to total distributions', () => {
  const raw = facts();
  const t = raw.facts['us-gaap'];
  t.CommonStockDividendsPerShareDeclared.units['USD/shares'].push(
    fact('2023-01-01', '2023-12-31', 0),
  );
  Object.assign(t, {
    PaymentsOfDividendsCommonStock: {
      units: { USD: [fact('2025-01-01', '2025-12-31', 9000000)] },
    },
  });
  const result = normalizeCompanyFacts(raw);
  expect(
    result.annual.find((x) => x.periodEnd === '2023-12-31')?.dividendsPerShare,
  ).toBe(0);
  expect(result.annual[0].dividendsPaid).toBe(9000000);
});
it('DPS YoY rejects mismatched filings/restatements', () => {
  const raw = facts();
  const observations =
    raw.facts['us-gaap'].CommonStockDividendsPerShareDeclared.units[
      'USD/shares'
    ];
  observations.find((x) => x.end === '2024-12-31')!.accn = 'unreconciled';
  expect(normalizeCompanyFacts(raw).annual[0].dpsGrowth).toBeNull();
});
