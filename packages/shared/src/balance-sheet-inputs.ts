/** Additive source metadata. Legacy totalDebt excludes finance leases; the new
 * financingDebt includes them. Missing components never imply a zero balance. */
export interface BalanceSheetInput {
  value: number | null;
  status: 'VERIFIED' | 'REVIEW_REQUIRED';
  reason: string | null;
  method: string;
  items: Record<string, unknown>[];
}
export interface BalanceSheetInputs {
  version: 2;
  periodEnd: string;
  accessionNumber: string | null;
  filed: string | null;
  consolidatedEquity: BalanceSheetInput;
  cash: BalanceSheetInput;
  currentFinancialInvestments: BalanceSheetInput;
  unclassifiedInvestments: BalanceSheetInput;
  financingDebt: BalanceSheetInput;
  financeLeases: BalanceSheetInput;
  debtComponents: Record<string, BalanceSheetInput>;
  financeLeasesIncludedInDebt: boolean | null;
}
