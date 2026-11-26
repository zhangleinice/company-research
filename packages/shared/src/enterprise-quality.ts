import type { ValuationFact } from './dcf.js';

/** SEC facts in USD; unknown or unapproved economic inputs remain null. */
export interface QualityCapitalSnapshot {
  periodEnd: string;
  equity: ValuationFact;
  debt: ValuationFact;
  cash: ValuationFact;
  securities: ValuationFact;
  verifiedInputs?: import('./balance-sheet-inputs.js').BalanceSheetInputs;
}
export interface EnterpriseQuality {
  operatingWorkingCapital?: {
    annual:
      import('./operating-working-capital.js').OperatingWorkingCapital | null;
    ttm:
      import('./operating-working-capital.js').OperatingWorkingCapital | null;
  };
  version: 1;
  ticker: string;
  cik: string | null;
  start: string | null;
  asOf: string | null;
  applicable: boolean | null;
  netIncome: ValuationFact;
  commonNetIncome: ValuationFact;
  depreciationAmortization: ValuationFact;
  depreciation: ValuationFact;
  amortization: ValuationFact;
  ebit: ValuationFact;
  capex: ValuationFact;
  taxExpense: ValuationFact;
  pretaxIncome: ValuationFact;
  historicalTaxRate: number | null;
  capital: QualityCapitalSnapshot[];
  quarterlyRoic?: import('./annual-roic.js').QuarterlyRoicHistory;
  annualRoic?: import('./annual-roic.js').AnnualRoicHistory;
}
