import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';

function fact(
  start: string,
  end: string,
  val: number,
  accn = 'latest',
  filed = '2026-02-01',
) {
  return { start, end, val, accn, filed, form: '10-K', fp: 'FY' };
}
function fixture() {
  const periods = [
    fact('2024-01-01', '2024-12-31', 100),
    fact('2025-01-01', '2025-12-31', 90),
    fact('2025-01-01', '2025-03-31', 95),
    fact('2025-04-01', '2025-06-30', 92),
    fact('2025-01-01', '2025-06-30', 93),
    fact('2025-01-01', '2025-09-30', 91),
  ];
  return {
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: periods } },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: { shares: [...periods] },
        },
        WeightedAverageNumberOfSharesOutstandingBasic: {
          units: { shares: periods.map((x) => ({ ...x, val: x.val - 1 })) },
        },
        PaymentsForRepurchaseOfCommonStock: { units: { USD: periods } },
      },
    },
  };
}
it('keeps money and shares separate and calculates negative annual shares YoY', () => {
  const raw = fixture();
  raw.facts[
    'us-gaap'
  ].WeightedAverageNumberOfDilutedSharesOutstanding.units.shares.push(
    fact('2025-01-01', '2025-12-31', 999, 'old', '2026-01-01'),
  );
  const p = normalizeCompanyFacts(raw).annual[0];
  expect(p.dilutedShares).toBe(90);
  expect(p.basicShares).toBe(89);
  expect(p.stockRepurchases).toBe(90);
  expect(p.dilutedSharesGrowth).toBeCloseTo(-10);
  expect(p.sources.dilutedSharesGrowth).toMatchObject({
    items: [{ accn: 'latest' }, { accn: 'latest' }],
  });
});
it('uses direct quarter shares and never subtracts YTD or full year averages', () => {
  const raw = fixture();
  raw.facts['us-gaap'].Revenues.units.USD.push(
    fact('2025-07-01', '2025-09-30', 50),
  );
  const q = normalizeCompanyFacts(raw).quarterly;
  expect(q.find((p) => p.periodEnd === '2025-06-30')?.dilutedShares).toBe(92);
  expect(q.find((p) => p.periodEnd === '2025-09-30')?.dilutedShares).toBeNull();
  expect(q.find((p) => p.periodEnd === '2025-12-31')?.dilutedShares).toBeNull();
});
it('rejects wrong units, nonpositive shares and incomparable split bases', () => {
  const raw = fixture();
  raw.facts[
    'us-gaap'
  ].WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [
    fact('2024-01-01', '2024-12-31', 100, 'old'),
    fact('2025-01-01', '2025-12-31', 900, 'new'),
  ];
  expect(normalizeCompanyFacts(raw).annual[0].dilutedSharesGrowth).toBeNull();
  raw.facts[
    'us-gaap'
  ].WeightedAverageNumberOfDilutedSharesOutstanding.units.shares[1].val = 0;
  expect(normalizeCompanyFacts(raw).annual[0].dilutedShares).toBeNull();
  const wrong = {
    facts: {
      'us-gaap': {
        Revenues: raw.facts['us-gaap'].Revenues,
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: { USD: [fact('2025-01-01', '2025-12-31', 90)] },
        },
      },
    },
  };
  expect(normalizeCompanyFacts(wrong).annual[0].dilutedShares).toBeNull();
});
it('compares independent quarterly shares with the same quarter a year earlier', () => {
  const raw = fixture();
  const prior = fact('2024-04-01', '2024-06-30', 100);
  raw.facts['us-gaap'].Revenues.units.USD.push(prior);
  raw.facts[
    'us-gaap'
  ].WeightedAverageNumberOfDilutedSharesOutstanding.units.shares.push(prior);
  expect(
    normalizeCompanyFacts(raw).quarterly.find(
      (p) => p.periodEnd === '2025-06-30',
    )?.dilutedSharesGrowth,
  ).toBeCloseTo(-8);
});
