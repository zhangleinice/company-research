import {
  compatibleDebtDisclosures,
  applyVerifiedDebtInputs,
} from './apply-debt-disclosure';
import type { DebtDisclosure } from './debt-disclosure';
import type { BalanceSheetInputs } from '@company-research/shared';
import { isObject } from './annual-financials';

import {
  BALANCE_TAGS,
  balanceReader,
  snapshotPick,
  balanceSource as source,
  capitalInputs,
  missingInput,
  reportedInput,
  calculatedInput,
  type HealthValue,
} from './balance-sheet-inputs';
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
  disclosures: readonly DebtDisclosure[] = [],
): HealthResult {
  if (disclosures.length && !accession) {
    const current = normalizeFinancialHealth(read, end);
    const policy = current.sources.financialHealthPolicy as {
      snapshotAccession: string | null;
      snapshotFiled: string | null;
    };
    const candidates = compatibleDebtDisclosures(
      read,
      end,
      disclosures,
      policy.snapshotAccession,
      policy.snapshotFiled,
    ).map((selected) => ({
      selected,
      result: normalizeFinancialHealth(
        (tag) => selected.facts.filter((x) => x.concept === `us-gaap:${tag}`),
        end,
        selected.filing.accessionNumber,
      ),
    }));
    const score = (c: (typeof candidates)[number]) =>
      (c.selected.financingDebt !== null ? 2 : 0) +
      (c.selected.plainDebt !== null || c.result.totalDebt !== null ? 1 : 0);
    candidates.sort((a, b) => score(b) - score(a));
    const chosen = candidates[0];
    if (!chosen) return current;
    const { selected, result } = chosen;
    if (selected.plainDebt !== null) {
      result.totalDebt = selected.plainDebt;
      result.shortTermDebt = selected.currentPlainDebt;
      result.longTermDebt = selected.noncurrentPlainDebt;
      result.netDebt =
        result.cash === null ? null : selected.plainDebt - result.cash;
      result.debtToEquity = ratio(selected.plainDebt, result.equity);
      result.sources.totalDebt = {
        method: 'sec_balance_sheet_and_debt_note',
        items: selected.evidence,
      };
    }
    applyVerifiedDebtInputs(
      result.sources.balanceSheetInputs as BalanceSheetInputs,
      selected,
    );
    const differences = candidates
      .filter(
        (c) =>
          c.selected.financingDebt !== null &&
          selected.financingDebt !== null &&
          c.selected.financingDebt !== selected.financingDebt,
      )
      .map((c) => ({
        filing: c.selected.filing,
        financingDebt: c.selected.financingDebt,
        reason: c.selected.reason,
      }));
    if (differences.length) {
      const inputs = result.sources.balanceSheetInputs as BalanceSheetInputs;
      inputs.financingDebt = {
        ...inputs.financingDebt,
        value: null,
        status: 'REVIEW_REQUIRED',
        reason:
          '兼容历史申报的含租赁债务合计不同，合并披露与后续分类范围尚待核准',
        items: [
          ...selected.evidence,
          ...candidates
            .filter((c) =>
              differences.some(
                (d) =>
                  d.filing.accessionNumber ===
                  c.selected.filing.accessionNumber,
              ),
            )
            .flatMap((c) => c.selected.evidence),
        ],
      };
      inputs.financeLeasesIncludedInDebt = null;
    }
    result.sources.debtDocumentProof = {
      version: selected.version,
      filing: selected.filing,
      reason: selected.reason,
      comparativeDifferences: differences,
      companyFactsSnapshot: policy,
      evidence: selected.evidence,
    };
    result.sources.financialHealthPolicy = {
      ...(result.sources.financialHealthPolicy as object),
      debtVerification: selected.version,
      missingDebt: result.totalDebt === null ? selected.reason : null,
    };
    return result;
  }
  // The reader normally filters units; enforce this boundary for every caller.
  const rawRead = read;
  read = (tag) => balanceReader(rawRead, end)(tag);
  const assetsAnchors = read('Assets');
  const anchor = (
    assetsAnchors.length
      ? assetsAnchors
      : read('CashAndCashEquivalentsAtCarryingValue')
  )
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
  const exactPick = snapshotPick(read, anchor?.fact.accn, anchor?.fact.filed);
  const pick = (...tags: string[]) => {
    const value = exactPick(...tags);
    return value && value.fact.val >= 0 ? value : undefined;
  };
  const conflictingTags = BALANCE_TAGS.filter(
    (tag) =>
      new Set(
        read(tag)
          .filter(
            (x) =>
              x.fact.accn === anchor?.fact.accn &&
              x.fact.filed === anchor?.fact.filed,
          )
          .map((x) => x.fact.val),
      ).size > 1,
  );
  const aliasBorrowingConflict =
    exactPick('ShortTermBorrowings') &&
    exactPick('ShortTermDebt') &&
    exactPick('ShortTermBorrowings')!.fact.val !==
      exactPick('ShortTermDebt')!.fact.val;
  let debtConflict =
    BALANCE_TAGS.some(
      (tag) =>
        /Debt|Borrow|CommercialPaper|FinanceLease/.test(tag) &&
        read(tag).some(
          (x) =>
            x.fact.accn === anchor?.fact.accn &&
            x.fact.filed === anchor?.fact.filed &&
            x.fact.val < 0,
        ),
    ) ||
    !!aliasBorrowingConflict ||
    conflictingTags.some((tag) =>
      /Debt|Borrow|CommercialPaper|FinanceLease/.test(tag),
    );
  const reported = (key: string, x: HealthValue | undefined) => {
    if (x) sources[key] = { method: 'reported', items: [source(x)] };
    return x?.fact.val ?? null;
  };
  const cash = reported('cash', pick('CashAndCashEquivalentsAtCarryingValue'));
  let securities = reported(
    'marketableSecurities',
    pick('MarketableSecuritiesCurrent', 'ShortTermInvestments'),
  );
  const currentAssets = reported('currentAssets', pick('AssetsCurrent'));
  const currentLiabilities = reported(
    'currentLiabilities',
    pick('LiabilitiesCurrent'),
  );
  // Negative equity is legitimate; retain it, but do not calculate Debt/Equity.
  const equityFact = exactPick('StockholdersEquity');
  const equity = reported('equity', equityFact);
  const directCurrent = pick('DebtCurrent');
  const currentLong = pick('LongTermDebtCurrent');
  const borrowings = pick('ShortTermBorrowings', 'ShortTermDebt');
  const cp = pick('CommercialPaper');
  const other = pick('OtherShortTermBorrowings');
  const input = (x: HealthValue | undefined) =>
    reportedInput(x, '缺少同一快照的债务组成');
  let shortBorrowings = missingInput(
    '短期借款总额未披露，商业票据及其他短期借款未完整核准',
    [cp, other].filter((x): x is HealthValue => !!x).map(source),
  );
  if (debtConflict)
    shortBorrowings = missingInput(
      '同一申报存在冲突债务事实，不能选择分项绕过冲突',
    );
  else if (borrowings) {
    const parts = [cp, other].filter((x): x is HealthValue => !!x);
    if (parts.reduce((sum, x) => sum + x.fact.val, 0) <= borrowings.fact.val)
      shortBorrowings = input(borrowings);
    else
      shortBorrowings = missingInput('短期借款总额小于已披露分项', [
        source(borrowings),
        ...parts.map(source),
      ]);
  } else if (cp && other) {
    shortBorrowings = calculatedInput(
      cp.fact.val + other.fact.val,
      'commercial_paper_plus_other_short_borrowings',
      [input(cp), input(other)],
    );
  }
  let shortTermDebt = reported('shortTermDebt', directCurrent);
  if (!directCurrent && currentLong && shortBorrowings.value !== null) {
    shortTermDebt = shortBorrowings.value + currentLong.fact.val;
    sources.shortTermDebt = {
      method: 'sum_current_borrowings',
      items: [...shortBorrowings.items, source(currentLong)],
    };
  }
  const combinedCurrent = pick('LongTermDebtAndCapitalLeaseObligationsCurrent');
  const financeCurrent = pick('FinanceLeaseLiabilityCurrent');
  if (
    !directCurrent &&
    !currentLong &&
    combinedCurrent &&
    financeCurrent &&
    shortBorrowings.value !== null &&
    combinedCurrent.fact.val >= financeCurrent.fact.val
  ) {
    shortTermDebt =
      shortBorrowings.value +
      combinedCurrent.fact.val -
      financeCurrent.fact.val;
    sources.shortTermDebt = {
      method: 'exclude_current_finance_leases',
      items: [
        ...shortBorrowings.items,
        source(combinedCurrent),
        source(financeCurrent),
      ],
    };
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
  if (directCurrent && !leaseCurrent) shortTermDebt = null;
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
  if (
    directCurrent &&
    currentLong &&
    leaseCurrent &&
    shortBorrowings.value !== null &&
    directCurrent.fact.val <
      currentLong.fact.val + leaseCurrent.fact.val + shortBorrowings.value
  )
    debtConflict = true;
  if (debtConflict) {
    shortTermDebt = null;
    longTermDebt = null;
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
    version: 2,
    snapshotAccession: anchor?.fact.accn ?? null,
    snapshotFiled: anchor?.fact.filed ?? null,
    conflictingTags,
    debt: 'carrying amounts; no face value, fair value, or unseparated noncurrent lease obligations',
    missingDebt:
      totalDebt !== null
        ? null
        : debtConflict
          ? '同一快照的债务披露冲突'
          : directCurrent && !leaseCurrent
            ? 'DebtCurrent包含融资租赁，缺少流动租赁分项，不能当作不含租赁债务'
            : shortTermDebt === null
              ? (shortBorrowings.reason ?? '流动长期债务尚未核准')
              : '非流动债务或组合标签的融资租赁范围未核准',
    selection: 'latest_assets_snapshot_or_reconciled_whole_snapshot',
  };
  const plainDebt =
    totalDebt === null
      ? missingInput(
          shortBorrowings.reason ?? '不含融资租赁的债务组成未核准',
          [sources.shortTermDebt, sources.longTermDebt].flatMap((x) =>
            isObject(x) && Array.isArray(x.items) ? x.items : [],
          ),
        )
      : {
          value: totalDebt,
          status: 'VERIFIED' as const,
          reason: null,
          method: 'current_plus_noncurrent_plain_debt',
          items: [sources.shortTermDebt, sources.longTermDebt].flatMap((x) =>
            isObject(x) && Array.isArray(x.items) ? x.items : [],
          ),
        };
  const inputs = capitalInputs(
    exactPick,
    { accn: anchor?.fact.accn, filed: anchor?.fact.filed, end },
    plainDebt,
    shortBorrowings,
  );
  const conflictEvidence = conflictingTags.flatMap((tag) =>
    read(tag)
      .filter(
        (x) =>
          x.fact.accn === anchor?.fact.accn &&
          x.fact.filed === anchor?.fact.filed,
      )
      .map(source),
  );
  if (debtConflict) {
    inputs.financingDebt = missingInput(
      '同一申报存在冲突的债务或租赁事实',
      conflictEvidence,
    );
    inputs.financeLeasesIncludedInDebt = null;
  }
  if (conflictingTags.some((tag) => /FinanceLease/.test(tag)))
    inputs.financeLeases = missingInput('融资租赁披露冲突', conflictEvidence);
  if (
    conflictingTags.some((tag) =>
      /Equity|MinorityInterest|^Assets$|^Liabilities$/.test(tag),
    )
  )
    inputs.consolidatedEquity = missingInput(
      '合并权益核准所需的事实存在冲突',
      conflictEvidence,
    );
  if (conflictingTags.some((tag) => /Securities|Investments/.test(tag)))
    inputs.currentFinancialInvestments = missingInput(
      '流动金融投资披露冲突',
      conflictEvidence,
    );
  sources.balanceSheetInputs = inputs;
  if (
    securities === null &&
    inputs.currentFinancialInvestments.value !== null
  ) {
    securities = inputs.currentFinancialInvestments.value;
    sources.marketableSecurities = {
      method: 'reconciled_current_investments',
      items: inputs.currentFinancialInvestments.items,
    };
  }
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
  if (
    !accession &&
    (totalDebt === null || equity === null || securities === null) &&
    anchor
  ) {
    const tags = BALANCE_TAGS;
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
    for (const older of conflictingTags.length ? [] : candidates) {
      if (older === anchor.fact.accn) continue;
      const reconciled = tags.every((tag) => {
        const newest = exactPick(tag);
        if (!newest) return true;
        const xs = read(tag).filter((x) => x.fact.accn === older);
        return xs.length > 0 && xs.every((x) => x.fact.val === newest.fact.val);
      });
      if (!reconciled) continue;
      const previous = normalizeFinancialHealth(read, end, older);
      const coverage = (x: HealthResult) =>
        [x.cash, x.equity, x.marketableSecurities, x.totalDebt].filter(
          (v) => v !== null,
        ).length;
      if (coverage(previous) > coverage(result)) {
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
