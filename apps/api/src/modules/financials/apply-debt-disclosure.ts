import type {
  BalanceSheetInputs,
  BalanceSheetInput,
} from '@company-research/shared';
import {
  balanceReader,
  snapshotPick,
  type BalanceReader,
} from './balance-sheet-inputs';
import type { DebtDisclosure } from './debt-disclosure';

/** Select a complete filing, not a mix of filing fragments. A newer financial
 * restatement blocks reuse if any core statement balance changed. */
export function compatibleDebtDisclosures(
  read: BalanceReader,
  end: string,
  disclosures: readonly DebtDisclosure[],
  accession: string | null,
  filed: string | null,
) {
  const latest = snapshotPick(
    balanceReader(read, end),
    accession ?? undefined,
    filed ?? undefined,
  );
  const core = [
    'Assets',
    'Liabilities',
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'CashAndCashEquivalentsAtCarryingValue',
    'AssetsCurrent',
    'LiabilitiesCurrent',
  ];
  return disclosures
    .filter(
      (d) =>
        d.periodEnd === end &&
        d.version === 'debt-disclosure-v1' &&
        d.facts.some(
          (x) => x.fact.end === end && x.fact.accn === d.filing.accessionNumber,
        ),
    )
    .filter((d) => {
      const pick = snapshotPick(
        balanceReader(
          (tag) => d.facts.filter((x) => x.concept === `us-gaap:${tag}`),
          end,
        ),
        d.filing.accessionNumber,
        d.filing.filingDate,
      );
      return (
        ['Assets', 'CashAndCashEquivalentsAtCarryingValue'].every(
          (tag) =>
            latest(tag) &&
            pick(tag) &&
            latest(tag)!.fact.val === pick(tag)!.fact.val,
        ) &&
        core.every(
          (tag) =>
            !latest(tag) ||
            (pick(tag) && pick(tag)!.fact.val === latest(tag)!.fact.val) ||
            (tag === 'Liabilities' &&
              latest(tag)!.fact.val === d.balanceLiabilities),
        )
      );
    })
    .sort((a, b) => b.filing.filingDate.localeCompare(a.filing.filingDate));
}
export function documentInput(
  value: number | null,
  d: DebtDisclosure,
  reason: string,
): BalanceSheetInput {
  return {
    value,
    status: value === null ? 'REVIEW_REQUIRED' : 'VERIFIED',
    reason: value === null ? reason : null,
    method: 'sec_balance_sheet_and_debt_note',
    items: d.evidence,
  };
}
export function applyVerifiedDebtInputs(
  inputs: BalanceSheetInputs,
  d: DebtDisclosure,
) {
  inputs.financingDebt = documentInput(
    d.financingDebt,
    d,
    d.reason ?? '融资租赁披露不足',
  );
  inputs.financeLeases = documentInput(
    d.financeLeases,
    d,
    '原文未能单独区分融资租赁与其他债务',
  );
  inputs.financeLeasesIncludedInDebt = d.financingDebt === null ? null : true;
  if (d.currentInvestments !== null) {
    inputs.currentFinancialInvestments = documentInput(
      d.currentInvestments,
      d,
      '流动投资分类未核准',
    );
    inputs.unclassifiedInvestments = {
      ...inputs.unclassifiedInvestments,
      status: 'VERIFIED',
      reason: null,
      method: 'primary_balance_sheet_current_assets_section',
      items: d.evidence,
    };
  }
}
