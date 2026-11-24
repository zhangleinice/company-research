import type {
  BalanceSheetInputs,
  BalanceSheetInput,
} from '@company-research/shared';

export interface HealthValue {
  fact: {
    end: string;
    val: number;
    accn: string;
    filed: string;
    form: string;
    start?: string;
    dimensions?: unknown;
  };
  concept: string;
  unit: string;
}
export type BalanceReader = (tag: string) => HealthValue[];
export const balanceSource = (x: HealthValue) => ({
  ...x.fact,
  concept: x.concept,
  unit: x.unit,
});
export const BALANCE_TAGS = [
  'Assets',
  'Liabilities',
  'LiabilitiesAndStockholdersEquity',
  'StockholdersEquity',
  'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  'MinorityInterest',
  'CashAndCashEquivalentsAtCarryingValue',
  'CashCashEquivalentsAndShortTermInvestments',
  'MarketableSecurities',
  'MarketableSecuritiesCurrent',
  'ShortTermInvestments',
  'OtherShortTermInvestments',
  'AssetsCurrent',
  'LiabilitiesCurrent',
  'DebtCurrent',
  'LongTermDebtCurrent',
  'LongTermDebtNoncurrent',
  'ShortTermBorrowings',
  'ShortTermDebt',
  'OtherShortTermBorrowings',
  'CommercialPaper',
  'LongTermDebtAndCapitalLeaseObligations',
  'LongTermDebtAndCapitalLeaseObligationsCurrent',
  'FinanceLeaseLiability',
  'FinanceLeaseLiabilityCurrent',
  'FinanceLeaseLiabilityNoncurrent',
  'LiabilitiesOfDisposalGroupIncludingDiscontinuedOperationCurrent',
  'LiabilitiesOfDisposalGroupIncludingDiscontinuedOperationNoncurrent',
  'LiabilitiesOfDisposalGroupIncludingDiscontinuedOperation',
] as const;

/** Only point-in-time, consolidated monetary observations. A cash-flow closing
 * cash observation alone cannot supersede a newer/older actual balance sheet. */
export function balanceReader(read: BalanceReader, end: string): BalanceReader {
  return (tag) =>
    read(tag).filter(
      (x) =>
        x.unit === 'USD' &&
        Number.isFinite(x.fact.val) &&
        !x.fact.start &&
        x.fact.end === end &&
        /^(10-K|10-Q|20-F|40-F)(\/A)?$/.test(x.fact.form) &&
        (x.fact.dimensions === undefined ||
          (typeof x.fact.dimensions === 'object' &&
            x.fact.dimensions !== null &&
            !Array.isArray(x.fact.dimensions) &&
            Object.keys(x.fact.dimensions).length === 0)),
    );
}
export function snapshotPick(
  read: BalanceReader,
  accn?: string,
  filed?: string,
) {
  return (...tags: string[]): HealthValue | undefined => {
    for (const tag of tags) {
      const xs = read(tag).filter(
        (x) => x.fact.accn === accn && x.fact.filed === filed,
      );
      if (xs.length)
        return xs.every((x) => x.fact.val === xs[0].fact.val)
          ? xs[0]
          : undefined;
    }
  };
}
export const missingInput = (
  reason: string,
  items: Record<string, unknown>[] = [],
): BalanceSheetInput => ({
  value: null,
  status: 'REVIEW_REQUIRED',
  reason,
  method: 'unverified',
  items,
});
export const reportedInput = (
  x: HealthValue | undefined,
  reason: string,
): BalanceSheetInput =>
  x
    ? {
        value: x.fact.val,
        status: 'VERIFIED',
        reason: null,
        method: 'reported',
        items: [balanceSource(x)],
      }
    : missingInput(reason);
export function calculatedInput(
  value: number,
  method: string,
  inputs: BalanceSheetInput[],
): BalanceSheetInput {
  const items = inputs.flatMap((x) => x.items);
  return inputs.every((x) => x.value !== null) && Number.isFinite(value)
    ? { value, status: 'VERIFIED', reason: null, method, items }
    : missingInput('组成项未完整核准', items);
}

export function capitalInputs(
  pick: ReturnType<typeof snapshotPick>,
  snapshot: { accn?: string; filed?: string; end: string },
  plainDebt: BalanceSheetInput,
  shortBorrowings: BalanceSheetInput,
): BalanceSheetInputs {
  const fact = (tag: string) =>
    reportedInput(pick(tag), `缺少同一快照的${tag}`);
  const nonnegative = (x: BalanceSheetInput) =>
    x.value !== null && x.value < 0
      ? missingInput('负债或资产金额为负，范围待核准', x.items)
      : x;
  const cash = nonnegative(fact('CashAndCashEquivalentsAtCarryingValue'));
  const parent = fact('StockholdersEquity'),
    nci = fact('MinorityInterest');
  let equity = fact(
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  );
  if (equity.value === null && parent.value !== null && nci.value !== null)
    equity = calculatedInput(
      parent.value + nci.value,
      'parent_plus_noncontrolling_equity',
      [parent, nci],
    );
  const assets = fact('Assets'),
    liabilities = fact('Liabilities');
  if (
    equity.value === null &&
    parent.value !== null &&
    assets.value !== null &&
    liabilities.value !== null &&
    assets.value - liabilities.value === parent.value
  )
    equity = calculatedInput(
      parent.value,
      'parent_equals_assets_less_liabilities',
      [parent, assets, liabilities],
    );
  if (
    equity.value !== null &&
    ((parent.value !== null &&
      nci.value !== null &&
      parent.value + nci.value !== equity.value) ||
      (assets.value !== null &&
        liabilities.value !== null &&
        assets.value - liabilities.value !== equity.value))
  )
    equity = missingInput('合并权益与权益组成或资产负债总额不勾稽', [
      ...equity.items,
      ...parent.items,
      ...nci.items,
      ...assets.items,
      ...liabilities.items,
    ]);

  const aggregate = nonnegative(
    fact('CashCashEquivalentsAndShortTermInvestments'),
  );
  const current = nonnegative(fact('MarketableSecuritiesCurrent'));
  const short = nonnegative(fact('ShortTermInvestments'));
  const other = nonnegative(fact('OtherShortTermInvestments'));
  // These are alternative scopes, never blindly additive. A disclosed cash+ST
  // aggregate identifies the complete current cash-management investment bucket.
  const choices = [current, short, other].filter((x) => x.value !== null);
  let investments = missingInput(
    '缺少可与现金及短期投资合计勾稽的流动投资范围',
  );
  const matches = choices.filter(
    (x) => cash.value !== null && aggregate.value === cash.value + x.value!,
  );
  if (matches.length)
    investments = calculatedInput(
      matches[0].value!,
      'reconciled_current_investments',
      [matches[0], cash, aggregate],
    );
  if (!matches.length && aggregate.value === null) {
    const totals = [current, short].filter((x) => x.value !== null);
    if (
      totals.length &&
      totals.every((x) => x.value === totals[0].value) &&
      other.value === null
    )
      investments = totals[0];
  }
  // Generic MarketableSecurities may span current/noncurrent or restricted
  // investments. Retain it as an unapproved candidate, not an alias or addend.
  const unclassifiedInvestments = fact('MarketableSecurities');
  if (
    unclassifiedInvestments.value !== null &&
    unclassifiedInvestments.value !== 0
  ) {
    unclassifiedInvestments.status = 'REVIEW_REQUIRED';
    unclassifiedInvestments.reason =
      '未区分流动、非流动或受限投资；保留披露金额，不纳入已核准流动投资合计';
  }

  const totalLease = nonnegative(fact('FinanceLeaseLiability'));
  const currentLease = nonnegative(fact('FinanceLeaseLiabilityCurrent'));
  const noncurrentLease = nonnegative(fact('FinanceLeaseLiabilityNoncurrent'));
  let leases = totalLease;
  if (
    leases.value === null &&
    currentLease.value !== null &&
    noncurrentLease.value !== null
  )
    leases = calculatedInput(
      currentLease.value + noncurrentLease.value,
      'current_plus_noncurrent_finance_leases',
      [currentLease, noncurrentLease],
    );
  if (
    totalLease.value !== null &&
    currentLease.value !== null &&
    noncurrentLease.value !== null &&
    totalLease.value !== currentLease.value + noncurrentLease.value
  )
    leases = missingInput('融资租赁合计与分项冲突', [
      ...totalLease.items,
      ...currentLease.items,
      ...noncurrentLease.items,
    ]);
  if (
    totalLease.value !== null &&
    ((currentLease.value !== null && currentLease.value > totalLease.value) ||
      (noncurrentLease.value !== null &&
        noncurrentLease.value > totalLease.value))
  )
    leases = missingInput('融资租赁分项大于披露合计', [
      ...totalLease.items,
      ...currentLease.items,
      ...noncurrentLease.items,
    ]);
  let debt =
    plainDebt.value !== null && leases.value !== null
      ? calculatedInput(
          plainDebt.value + leases.value,
          'plain_debt_plus_finance_leases',
          [plainDebt, leases],
        )
      : missingInput(
          plainDebt.reason ?? leases.reason ?? '不含租赁债务或融资租赁范围缺失',
          [...plainDebt.items, ...leases.items],
        );
  const combinedCurrent = nonnegative(
    fact('LongTermDebtAndCapitalLeaseObligationsCurrent'),
  );
  const combinedLong = nonnegative(
    fact('LongTermDebtAndCapitalLeaseObligations'),
  );
  if (
    combinedCurrent.value !== null &&
    combinedLong.value !== null &&
    shortBorrowings.value !== null
  ) {
    const combined = calculatedInput(
      combinedCurrent.value + combinedLong.value + shortBorrowings.value,
      'short_borrowings_plus_current_and_noncurrent_debt_including_leases',
      [shortBorrowings, combinedCurrent, combinedLong],
    );
    debt =
      debt.value !== null && debt.value !== combined.value
        ? missingInput('含租赁债务的两种口径不勾稽', [
            ...debt.items,
            ...combined.items,
          ])
        : combined;
  }
  const directCurrent = nonnegative(fact('DebtCurrent'));
  const plainLong = nonnegative(fact('LongTermDebtNoncurrent'));
  if (directCurrent.value !== null) {
    let complete = missingInput('流动债务包含租赁，非流动组成尚未核准');
    if (combinedLong.value !== null)
      complete = calculatedInput(
        directCurrent.value + combinedLong.value,
        'reported_current_debt_and_noncurrent_debt_including_leases',
        [directCurrent, combinedLong],
      );
    else if (plainLong.value !== null && noncurrentLease.value !== null)
      complete = calculatedInput(
        directCurrent.value + plainLong.value + noncurrentLease.value,
        'current_debt_including_leases_plus_noncurrent_components',
        [directCurrent, plainLong, noncurrentLease],
      );
    if (complete.value !== null)
      debt =
        debt.value !== null && debt.value !== complete.value
          ? missingInput('直接债务合计与组成项冲突', [
              ...debt.items,
              ...complete.items,
            ])
          : complete;
  }
  const disposal = [
    'LiabilitiesOfDisposalGroupIncludingDiscontinuedOperation',
    'LiabilitiesOfDisposalGroupIncludingDiscontinuedOperationCurrent',
    'LiabilitiesOfDisposalGroupIncludingDiscontinuedOperationNoncurrent',
  ]
    .map(fact)
    .filter((x) => x.value !== null && x.value !== 0);
  if (disposal.length)
    debt = missingInput(
      '存在待售处置组负债，债务是否包含其中尚未核准；不自动加减',
      [...debt.items, ...disposal.flatMap((x) => x.items)],
    );
  return {
    version: 2,
    periodEnd: snapshot.end,
    accessionNumber: snapshot.accn ?? null,
    filed: snapshot.filed ?? null,
    consolidatedEquity: equity,
    cash,
    currentFinancialInvestments: investments,
    unclassifiedInvestments,
    financingDebt: debt,
    financeLeases: leases,
    financeLeasesIncludedInDebt: debt.value === null ? null : true,
    debtComponents: Object.fromEntries(
      [
        'DebtCurrent',
        'ShortTermBorrowings',
        'ShortTermDebt',
        'CommercialPaper',
        'OtherShortTermBorrowings',
        'LongTermDebtCurrent',
        'LongTermDebtNoncurrent',
        'LongTermDebtAndCapitalLeaseObligationsCurrent',
        'LongTermDebtAndCapitalLeaseObligations',
      ].map((tag) => [tag, nonnegative(fact(tag))]),
    ),
  };
}
