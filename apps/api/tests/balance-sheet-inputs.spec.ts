import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeFinancialHealth } from '../src/modules/financials/financial-health';
import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
import type { BalanceSheetInputs } from '@company-research/shared';
import type { HealthValue } from '../src/modules/financials/balance-sheet-inputs';
function fixture() {
  const values: Record<string, HealthValue[]> = {};
  const add = (
    tag: string,
    val: number,
    extra: Partial<HealthValue['fact']> = {},
  ) => {
    (values[tag] ??= []).push({
      concept: `us-gaap:${tag}`,
      unit: 'USD',
      fact: {
        end: '2025-12-31',
        val,
        filed: '2026-02-01',
        accn: 'current',
        form: '10-K',
        ...extra,
      },
    });
  };
  for (const [tag, val] of Object.entries({
    Assets: 1000,
    Liabilities: 500,
    StockholdersEquity: 490,
    MinorityInterest: 10,
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: 500,
    CashAndCashEquivalentsAtCarryingValue: 100,
    MarketableSecuritiesCurrent: 50,
    CashCashEquivalentsAndShortTermInvestments: 150,
    LongTermDebtCurrent: 100,
    LongTermDebtNoncurrent: 200,
    CommercialPaper: 20,
    OtherShortTermBorrowings: 5,
    FinanceLeaseLiability: 10,
    FinanceLeaseLiabilityCurrent: 3,
    FinanceLeaseLiabilityNoncurrent: 7,
  }))
    add(tag, val);
  const read = (tag: string) => values[tag] ?? [];
  const run = () => normalizeFinancialHealth(read, '2025-12-31');
  const inputs = () => run().sources.balanceSheetInputs as BalanceSheetInputs;
  return { add, values, read, run, inputs };
}
it('keeps legacy parent equity/debt excluding leases separate from consolidated equity and financing debt', () => {
  const { run, inputs } = fixture();
  expect(run()).toMatchObject({ equity: 490, totalDebt: 325 });
  expect(inputs()).toMatchObject({
    version: 2,
    consolidatedEquity: { value: 500 },
    financeLeases: { value: 10 },
    financingDebt: { value: 335 },
    financeLeasesIncludedInDebt: true,
  });
  expect(inputs()).not.toHaveProperty('roic');
  expect(inputs()).not.toHaveProperty('nopat');
});
it('does not add CP/other borrowings to an aggregate; rejects inconsistent aggregates', () => {
  const { add, run, inputs } = fixture();
  add('ShortTermBorrowings', 40);
  expect(run().totalDebt).toBe(340);
  add('ShortTermBorrowings', 10); // conflicting same-filing facts cannot choose first
  expect(run().totalDebt).toBeNull();
  expect(inputs().financingDebt.value).toBeNull();
});
it('preserves explicit zero components and leaves an omitted other-borrowing component pending', () => {
  const f = fixture();
  delete f.values.OtherShortTermBorrowings;
  expect(f.run().totalDebt).toBeNull();
  expect(f.inputs().debtComponents.CommercialPaper.value).toBe(20);
  for (const tag of [
    'LongTermDebtCurrent',
    'LongTermDebtNoncurrent',
    'CommercialPaper',
    'FinanceLeaseLiability',
    'FinanceLeaseLiabilityCurrent',
    'FinanceLeaseLiabilityNoncurrent',
  ])
    f.values[tag][0].fact.val = 0;
  f.add('OtherShortTermBorrowings', 0);
  expect(f.run().totalDebt).toBe(0);
  expect(f.inputs().financingDebt.value).toBe(0);
});
it('handles current/noncurrent combinations including leases without counting leases twice', () => {
  const f = fixture();
  delete f.values.LongTermDebtCurrent;
  delete f.values.LongTermDebtNoncurrent;
  f.add('LongTermDebtAndCapitalLeaseObligationsCurrent', 103);
  f.add('LongTermDebtAndCapitalLeaseObligations', 207);
  expect(f.run().totalDebt).toBe(325);
  expect(f.inputs().financingDebt.value).toBe(335);
  delete f.values.FinanceLeaseLiability;
  delete f.values.FinanceLeaseLiabilityCurrent;
  delete f.values.FinanceLeaseLiabilityNoncurrent;
  expect(f.run().totalDebt).toBeNull();
  expect(f.inputs().financingDebt.value).toBe(335); // reported combination already includes leases
  expect(f.inputs().financeLeases.value).toBeNull();
});
it('does not use face value as carrying debt, or inconsistent lease totals', () => {
  const f = fixture();
  delete f.values.LongTermDebtNoncurrent;
  f.add('LongTermDebt', 999);
  expect(f.run().totalDebt).toBeNull();
  const g = fixture();
  g.values.FinanceLeaseLiability[0].fact.val = 12;
  expect(g.inputs().financeLeases.value).toBeNull();
  expect(g.inputs().financingDebt.value).toBeNull();
});
it('can use directly reported current debt including leases without adding its lease subset again', () => {
  const f = fixture();
  f.add('DebtCurrent', 128);
  expect(f.run().totalDebt).toBe(325);
  expect(f.inputs().financingDebt.value).toBe(335);
});
it('requires disjoint, reconciled investment scopes; never sums similarly named or overlapping tags', () => {
  const f = fixture();
  f.add('ShortTermInvestments', 50);
  f.add('MarketableSecurities', 700);
  expect(f.inputs().currentFinancialInvestments.value).toBe(50);
  expect(f.inputs().unclassifiedInvestments.value).toBe(700);
  delete f.values.MarketableSecuritiesCurrent;
  delete f.values.ShortTermInvestments;
  f.add('OtherShortTermInvestments', 50);
  expect(f.inputs().currentFinancialInvestments.value).toBe(50);
  expect(f.run().marketableSecurities).toBe(50);
  f.values.CashCashEquivalentsAndShortTermInvestments[0].fact.val = 160;
  expect(f.inputs().currentFinancialInvestments.value).toBeNull();
});
it('accepts an explicitly current investment total without needing a cash aggregate, but rejects conflicting totals', () => {
  const f = fixture();
  delete f.values.CashCashEquivalentsAndShortTermInvestments;
  expect(f.inputs().currentFinancialInvestments.value).toBe(50);
  f.add('ShortTermInvestments', 60);
  expect(f.inputs().currentFinancialInvestments.value).toBeNull();
});
it('uses consolidated equity only with consistent attribution, and never substitutes NCI as zero', () => {
  const f = fixture();
  delete f.values
    .StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest;
  expect(f.inputs().consolidatedEquity.value).toBe(500);
  delete f.values.MinorityInterest;
  expect(f.inputs().consolidatedEquity.value).toBeNull();
  f.values.StockholdersEquity[0].fact.val = 500;
  expect(f.inputs().consolidatedEquity.value).toBe(500); // identity with A-L proves no residual
  f.add(
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    510,
  );
  expect(f.inputs().consolidatedEquity.value).toBeNull();
});
it('keeps disposal-group debt pending; does not zero-fill unclassified obligations', () => {
  const f = fixture();
  f.add('LiabilitiesOfDisposalGroupIncludingDiscontinuedOperationCurrent', 8);
  expect(f.inputs().financingDebt).toMatchObject({
    value: null,
    status: 'REVIEW_REQUIRED',
  });
  expect(f.inputs().financingDebt.reason).toContain('待售');
});
it('restores a complete historical snapshot as a whole only after overlapping values reconcile', () => {
  const f = fixture();
  for (const rows of Object.values(f.values)) {
    rows[0].fact.accn = 'older';
    rows[0].fact.filed = '2026-01-01';
  }
  f.add('Assets', 1000);
  f.add('CashAndCashEquivalentsAtCarryingValue', 100);
  expect(f.run().equity).toBe(490);
  expect(f.inputs().accessionNumber).toBe('older');
  f.values.CashAndCashEquivalentsAtCarryingValue.find(
    (x) => x.fact.accn === 'current',
  )!.fact.val = 101;
  expect(f.run().equity).toBeNull();
  expect(f.inputs().accessionNumber).toBe('current');
});
it('ignores later cash-flow-only observations and never crosses currencies, dates, dimensions or accessions', () => {
  const f = fixture();
  f.add('CashAndCashEquivalentsAtCarryingValue', 200, {
    accn: 'cash-flow-only',
    filed: '2026-03-01',
  });
  expect(f.run().cash).toBe(100);
  f.values.OtherShortTermBorrowings[0].fact.dimensions = { Segment: 'A' };
  expect(f.run().totalDebt).toBeNull();
});

const real = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/balance-sheet-regression.json'),
    'utf8',
  ),
);
it('SEC regression: KO 2022/2023 original coherent snapshots include other short-term borrowings', () => {
  const raw = real.KO.raw.facts['us-gaap'];
  const read = (tag: string): HealthValue[] =>
    (raw[tag]?.units.USD ?? []).map((fact: HealthValue['fact']) => ({
      fact,
      concept: `us-gaap:${tag}`,
      unit: 'USD',
    }));
  expect(
    normalizeFinancialHealth(read, '2022-12-31', '0000021344-24-000009')
      .totalDebt,
  ).toBe(39149e6);
  expect(
    normalizeFinancialHealth(read, '2023-12-31', '0000021344-24-000009')
      .totalDebt,
  ).toBe(42064e6);
});
it.each(['GOOGL', 'AAPL', 'MSFT', 'KO'])(
  'SEC regression: %s keeps four actual annual dates, cash and versioned provenance after JSON persistence',
  (ticker) => {
    const f = real[ticker];
    const rows = normalizeCompanyFacts(f.raw).annual;
    for (const end of f.periodEnds) {
      const row = rows.find((x) => x.periodEnd === end)!;
      expect(row).toBeDefined();
      const before = f.before.find(
        (x: { periodEnd: string }) => x.periodEnd === end,
      );
      expect(row.cash).toBe(before.cash);
      const stored = JSON.parse(JSON.stringify(row.sources)).balanceSheetInputs;
      expect(stored.version).toBe(2);
      expect(stored.periodEnd).toBe(end);
      expect(stored.cash.items[0]).toMatchObject({
        end,
        unit: 'USD',
        accn: stored.accessionNumber,
      });
      if (ticker === 'KO' && end === '2024-12-31')
        expect(row.equity).toBe(24856e6);
      if (ticker === 'MSFT' && end === '2026-06-30') {
        expect(row.totalDebt).toBeNull();
        expect(stored.debtComponents.LongTermDebtCurrent.value).toBe(9227e6);
        expect(stored.financeLeases.value).toBe(66594e6);
      }
    }
  },
);

it('rejects a current-debt aggregate below its disclosed components and negative aggregate borrowing', () => {
  const f = fixture();
  f.add('DebtCurrent', 120);
  expect(f.run().totalDebt).toBeNull();
  expect(f.inputs().financingDebt.value).toBeNull();
  const g = fixture();
  g.add('ShortTermBorrowings', -1);
  expect(g.run().totalDebt).toBeNull();
});
