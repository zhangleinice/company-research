import { isObject } from './annual-financials';

interface Observation {
  end: string;
  val: number;
  accn: string;
  filed: string;
  form: string;
  start?: string;
}
interface HealthValue {
  fact: Observation;
  concept: string;
  unit: string;
}
const source = (x: HealthValue) => ({
  ...x.fact,
  concept: x.concept,
  unit: x.unit,
});
const ratio = (a: number | null, b: number | null) =>
  a !== null && b !== null && b > 0 && Number.isFinite(a / b) ? a / b : null;

/** A coherent balance-sheet snapshot, never duration/YTD subtraction. */
interface HealthResult {
  cash: number | null;
  marketableSecurities: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  equity: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  totalDebt: number | null;
  netDebt: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  sources: Record<string, unknown>;
}
export function normalizeFinancialHealth(
  read: (tag: string) => HealthValue[],
  end: string,
  accession?: string,
): HealthResult {
  // The reader normally filters units; enforce this boundary for every caller.
  const rawRead = read;
  read = (tag) =>
    rawRead(tag).filter((x) => x.unit === 'USD' && Number.isFinite(x.fact.val));
  const anchor = [
    ...read('Assets'),
    ...read('CashAndCashEquivalentsAtCarryingValue'),
  ]
    .filter(
      (x) =>
        !x.fact.start &&
        x.fact.end === end &&
        (!accession || x.fact.accn === accession),
    )
    .sort(
      (a, b) =>
        b.fact.filed.localeCompare(a.fact.filed) ||
        b.fact.accn.localeCompare(a.fact.accn),
    )[0];
  const sources: Record<string, unknown> = {};
  const pick = (...tags: string[]) => {
    for (const tag of tags) {
      const value = read(tag).find(
        (x) =>
          !x.fact.start &&
          x.fact.end === end &&
          x.fact.accn === anchor?.fact.accn &&
          x.fact.filed === anchor?.fact.filed &&
          x.fact.val >= 0,
      );
      if (value) return value;
    }
  };
  const reported = (key: string, x: HealthValue | undefined) => {
    if (x) sources[key] = { method: 'reported', items: [source(x)] };
    return x?.fact.val ?? null;
  };
  const cash = reported('cash', pick('CashAndCashEquivalentsAtCarryingValue'));
  const securities = reported(
    'marketableSecurities',
    pick('MarketableSecuritiesCurrent', 'ShortTermInvestments'),
  );
  const currentAssets = reported('currentAssets', pick('AssetsCurrent'));
  const currentLiabilities = reported(
    'currentLiabilities',
    pick('LiabilitiesCurrent'),
  );
  // Negative equity is legitimate; retain it, but do not calculate Debt/Equity.
  const equityFact = read('StockholdersEquity').find(
    (x) =>
      !x.fact.start &&
      x.fact.end === end &&
      x.fact.accn === anchor?.fact.accn &&
      x.fact.filed === anchor?.fact.filed,
  );
  const equity = reported('equity', equityFact);
  const directCurrent = pick('DebtCurrent');
  const currentLong = pick('LongTermDebtCurrent');
  const borrowings = pick('ShortTermBorrowings', 'ShortTermDebt');
  const cp = pick('CommercialPaper');
  let shortTermDebt = reported('shortTermDebt', directCurrent);
  if (!directCurrent && currentLong && (borrowings || cp)) {
    // Aggregate short-term borrowings already include commercial paper: never add CP twice.
    const short = borrowings ?? cp!;
    if (!borrowings || !cp || cp.fact.val <= borrowings.fact.val) {
      shortTermDebt = short.fact.val + currentLong.fact.val;
      sources.shortTermDebt = {
        method: 'sum_current_borrowings',
        items: [source(short), source(currentLong)],
      };
    }
  }
  const long = pick('LongTermDebtNoncurrent');
  let longTermDebt = reported('longTermDebt', long);
  if (!long) {
    const combined = pick('LongTermDebtAndCapitalLeaseObligations');
    const lease = pick('FinanceLeaseLiability');
    const currentLease = pick('FinanceLeaseLiabilityCurrent');
    // Explicitly remove the lease subset, instead of relabeling debt+leases as plain debt.
    if (
      combined &&
      lease &&
      currentLease &&
      lease.fact.val >= currentLease.fact.val &&
      combined.fact.val >= lease.fact.val - currentLease.fact.val
    ) {
      longTermDebt =
        combined.fact.val - (lease.fact.val - currentLease.fact.val);
      sources.longTermDebt = {
        method: 'exclude_finance_leases',
        formula:
          'noncurrentDebtAndLeases-(totalFinanceLeases-currentFinanceLeases)',
        items: [source(combined), source(lease), source(currentLease)],
      };
    }
  }
  const leaseCurrent = pick('FinanceLeaseLiabilityCurrent');
  if (directCurrent && leaseCurrent) {
    shortTermDebt =
      directCurrent.fact.val >= leaseCurrent.fact.val
        ? directCurrent.fact.val - leaseCurrent.fact.val
        : null;
    sources.shortTermDebt = {
      method: 'exclude_current_finance_leases',
      items: [source(directCurrent), source(leaseCurrent)],
    };
  }
  const totalDebt =
    shortTermDebt !== null && longTermDebt !== null
      ? shortTermDebt + longTermDebt
      : null;
  if (totalDebt !== null)
    sources.totalDebt = {
      method: 'calculated',
      formula: 'currentDebt+noncurrentDebt',
      inputs: [sources.shortTermDebt, sources.longTermDebt],
    };
  sources.financialHealthPolicy = {
    version: 1,
    snapshotAccession: anchor?.fact.accn ?? null,
    debt: 'carrying amounts; no face value, fair value, or unseparated noncurrent lease obligations',
    missingDebt:
      totalDebt === null
        ? 'No complete, compatible current/noncurrent debt in this snapshot; missing is not zero'
        : null,
  };
  const combinedCash = pick('CashCashEquivalentsAndShortTermInvestments');
  if (
    cash !== null &&
    securities !== null &&
    combinedCash &&
    combinedCash.fact.val === cash + securities
  ) {
    sources.verifiedLiquidAssets = {
      method: 'reconciled_reported_total',
      amount: combinedCash.fact.val,
      cash,
      securities,
      items: [source(combinedCash)],
      scope:
        'cash equivalents plus separately classified current marketable securities; excludes noncurrent investments',
    };
  }
  const result = {
    cash,
    marketableSecurities: securities,
    currentAssets,
    currentLiabilities,
    equity,
    shortTermDebt,
    longTermDebt,
    totalDebt,
    netDebt: totalDebt !== null && cash !== null ? totalDebt - cash : null,
    currentRatio: ratio(currentAssets, currentLiabilities),
    debtToEquity: ratio(totalDebt, equity),
    sources,
  };
  // Later comparative filings may omit an explicit zero debt component. Reuse an
  // older coherent snapshot only after all overlapping balances/debt inputs reconcile.
  if (!accession && totalDebt === null && anchor) {
    const tags = [
      'CashAndCashEquivalentsAtCarryingValue',
      'MarketableSecuritiesCurrent',
      'ShortTermInvestments',
      'AssetsCurrent',
      'LiabilitiesCurrent',
      'Assets',
      'StockholdersEquity',
      'DebtCurrent',
      'LongTermDebtCurrent',
      'ShortTermBorrowings',
      'ShortTermDebt',
      'CommercialPaper',
      'LongTermDebtNoncurrent',
      'LongTermDebtAndCapitalLeaseObligations',
      'FinanceLeaseLiability',
      'FinanceLeaseLiabilityCurrent',
    ];
    const candidates = [
      ...new Set(
        read('Assets')
          .filter(
            (x) =>
              !x.fact.start &&
              x.fact.end === end &&
              x.fact.filed <= anchor.fact.filed,
          )
          .sort((a, b) => b.fact.filed.localeCompare(a.fact.filed))
          .map((x) => x.fact.accn),
      ),
    ];
    for (const older of candidates) {
      if (older === anchor.fact.accn) continue;
      const reconciled = tags.every((tag) => {
        const newest = pick(tag);
        if (!newest) return true;
        return read(tag).some(
          (x) =>
            !x.fact.start &&
            x.fact.end === end &&
            x.fact.accn === older &&
            x.fact.val === newest.fact.val,
        );
      });
      if (!reconciled) continue;
      const previous = normalizeFinancialHealth(read, end, older);
      if (previous.totalDebt !== null) {
        previous.sources.snapshotReconciliation = {
          method: 'matching_overlapping_balances',
          latestAccession: anchor.fact.accn,
          selectedAccession: older,
        };
        return previous;
      }
    }
  }
  return result;
}

/** Expose optional liquidity metrics only when persisted provenance reconciles the disjoint inputs. */
export function verifiedLiquidity(
  cash: number | null,
  securities: number | null,
  debt: number | null,
  sources: unknown,
) {
  const evidence = isObject(sources) ? sources.verifiedLiquidAssets : null;
  const verified =
    isObject(evidence) &&
    evidence.method === 'reconciled_reported_total' &&
    cash !== null &&
    securities !== null &&
    evidence.cash === cash &&
    evidence.securities === securities &&
    evidence.amount === cash + securities;
  const cashAndShortTermSecurities = verified ? cash + securities : null;
  return {
    cashAndShortTermSecurities,
    netDebtAfterLiquidAssets:
      cashAndShortTermSecurities !== null && debt !== null
        ? debt - cashAndShortTermSecurities
        : null,
  };
}
