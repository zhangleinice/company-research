import {
  normalizeFinancialHealth,
  verifiedLiquidity,
} from '../src/modules/financials/financial-health';

function fixture() {
  const values: Record<
    string,
    {
      fact: {
        end: string;
        val: number;
        accn: string;
        filed: string;
        form: string;
        start?: string;
      };
      concept: string;
      unit: string;
    }[]
  > = {};
  const add = (tag: string, val: number, extra = {}) => {
    (values[tag] ??= []).push({
      fact: {
        end: '2025-12-31',
        val,
        accn: 'latest',
        filed: '2026-02-05',
        form: '10-K',
        ...extra,
      },
      concept: `us-gaap:${tag}`,
      unit: 'USD',
    });
  };
  for (const [tag, val] of Object.entries({
    Assets: 595281,
    CashAndCashEquivalentsAtCarryingValue: 30708,
    MarketableSecuritiesCurrent: 96135,
    CashCashEquivalentsAndShortTermInvestments: 126843,
    AssetsCurrent: 206038,
    LiabilitiesCurrent: 102745,
    StockholdersEquity: 415265,
    CommercialPaper: 0,
    LongTermDebtCurrent: 1996,
    LongTermDebtNoncurrent: 46547,
  }))
    add(tag, val);
  const read = (tag: string) => values[tag] ?? [];
  return { values, add, read };
}

describe('financial health period-end snapshots', () => {
  it('reconciles Alphabet 2025 balance sheet and separates verified liquid assets', () => {
    const { read } = fixture();
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(row).toMatchObject({
      cash: 30708,
      marketableSecurities: 96135,
      totalDebt: 48543,
      netDebt: 17835,
    });
    expect(row.currentRatio).toBeCloseTo(206038 / 102745);
    expect(row.debtToEquity).toBeCloseTo(48543 / 415265);
    expect(
      verifiedLiquidity(
        row.cash,
        row.marketableSecurities,
        row.totalDebt,
        row.sources,
      ),
    ).toEqual({
      cashAndShortTermSecurities: 126843,
      netDebtAfterLiquidAssets: -78300,
    });
  });
  it('does not infer a liquid-asset total from two amounts without a reconciled disclosed aggregate', () => {
    const { read, values } = fixture();
    delete values.CashCashEquivalentsAndShortTermInvestments;
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(
      verifiedLiquidity(
        row.cash,
        row.marketableSecurities,
        row.totalDebt,
        row.sources,
      ).cashAndShortTermSecurities,
    ).toBeNull();
  });
  it('rejects inconsistent aggregate amounts and stale evidence', () => {
    const { read, values } = fixture();
    values.CashCashEquivalentsAndShortTermInvestments[0].fact.val++;
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(
      verifiedLiquidity(
        row.cash,
        row.marketableSecurities,
        row.totalDebt,
        row.sources,
      ).cashAndShortTermSecurities,
    ).toBeNull();
    expect(
      verifiedLiquidity(1, 2, 3, {
        verifiedLiquidAssets: {
          method: 'reconciled_reported_total',
          cash: 4,
          securities: 5,
          amount: 9,
        },
      }).cashAndShortTermSecurities,
    ).toBeNull();
  });
  it('keeps a missing current debt component missing instead of substituting zero or face value', () => {
    const { read, values, add } = fixture();
    delete values.LongTermDebtCurrent;
    add('LongTermDebt', 49085);
    add('LongTermDebtFairValue', 45600);
    expect(normalizeFinancialHealth(read, '2025-12-31').totalDebt).toBeNull();
  });
  it('never adds commercial paper on top of an aggregate short-term borrowing balance', () => {
    const { read, add } = fixture();
    add('ShortTermBorrowings', 3000);
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(row.totalDebt).toBe(3000 + 1996 + 46547);
  });
  it('removes explicitly identified finance leases from a historical noncurrent combined balance', () => {
    const { read, values, add } = fixture();
    delete values.LongTermDebtNoncurrent;
    add('LongTermDebtAndCapitalLeaseObligations', 14701);
    add('FinanceLeaseLiability', 2142);
    add('FinanceLeaseLiabilityCurrent', 298);
    expect(normalizeFinancialHealth(read, '2025-12-31').longTermDebt).toBe(
      12857,
    );
    delete values.FinanceLeaseLiabilityCurrent;
    expect(
      normalizeFinancialHealth(read, '2025-12-31').longTermDebt,
    ).toBeNull();
  });
  it('does not mix accessions, units or observation dates; never differences quarter balances', () => {
    const { read, values } = fixture();
    values.CommercialPaper[0].fact.accn = 'old';
    values.LongTermDebtNoncurrent[0].fact.end = '2025-09-30';
    expect(normalizeFinancialHealth(read, '2025-12-31').totalDebt).toBeNull();
    expect(normalizeFinancialHealth(read, '2025-09-30').cash).toBeNull();
  });
  it('rejects incompatible currencies and nonfinite balances', () => {
    const { read, values } = fixture();
    values.LongTermDebtNoncurrent[0].unit = 'EUR';
    values.LiabilitiesCurrent[0].fact.val = Infinity;
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(row.totalDebt).toBeNull();
    expect(row.currentRatio).toBeNull();
  });
  it('preserves negative net debt, rejects zero current liabilities and nonpositive equity', () => {
    const { read, values } = fixture();
    values.CashAndCashEquivalentsAtCarryingValue[0].fact.val = 100000;
    values.StockholdersEquity[0].fact.val = -1;
    values.LiabilitiesCurrent[0].fact.val = 0;
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(row.netDebt).toBe(-51457);
    expect(row.currentRatio).toBeNull();
    expect(row.debtToEquity).toBeNull();
  });
  it('can restore an older explicit current zero only when all overlapping snapshot inputs match', () => {
    const { read, values, add } = fixture();
    for (const [tag, rows] of Object.entries(values)) {
      rows[0].fact.accn = 'old';
      rows[0].fact.filed = '2026-02-01';
      if (tag !== 'LongTermDebtCurrent') add(tag, rows[0].fact.val);
    }
    const row = normalizeFinancialHealth(read, '2025-12-31');
    expect(row.totalDebt).toBe(48543);
    expect(row.sources.snapshotReconciliation).toBeDefined();
    values.Assets.find((x) => x.fact.accn === 'latest')!.fact.val++;
    expect(normalizeFinancialHealth(read, '2025-12-31').totalDebt).toBeNull();
  });
});
