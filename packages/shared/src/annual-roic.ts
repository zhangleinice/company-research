import type {
  BalanceSheetInput,
  BalanceSheetInputs,
} from './balance-sheet-inputs.js';

export const ANNUAL_ROIC_POLICY_VERSION = 'annual-roic-v1' as const;
export const ANNUAL_ROIC_INPUT_VERSION = 'annual-roic-inputs-v1' as const;
export interface AnnualRoicInputs {
  version: typeof ANNUAL_ROIC_INPUT_VERSION;
  fiscalYear: number | null;
  periodStart: string;
  periodEnd: string;
  currency: 'USD';
  cik: string | null;
  sic: string | null;
  industrySourceUrl: string | null;
  operatingIncome: BalanceSheetInput;
  incomeTaxExpense: BalanceSheetInput;
  pretaxIncome: BalanceSheetInput;
  taxDisclosures: {
    concept: string;
    label: string;
    input: BalanceSheetInput;
  }[];
}
export interface RoicIssue {
  code: string;
  field: string;
  message: string;
}
export interface RoicCapital {
  periodEnd: string;
  investedCapital: number | null;
  components: BalanceSheetInputs | null;
  issues: RoicIssue[];
}
export interface AnnualRoicResult {
  policyVersion: typeof ANNUAL_ROIC_POLICY_VERSION;
  fiscalYear: number | null;
  periodStart: string;
  periodEnd: string;
  currency: string | null;
  status: 'READY' | 'MISSING_DATA' | 'INVALID_INPUT' | 'NOT_APPLICABLE';
  operatingIncome: number | null;
  incomeTaxExpense: number | null;
  pretaxIncome: number | null;
  /** Dimensionless ratios: 1 means 100%. No intermediate rounding. */
  historicalEffectiveTaxRate: number | null;
  nopat: number | null;
  beginningInvestedCapital: number | null;
  endingInvestedCapital: number | null;
  averageInvestedCapital: number | null;
  roic: number | null;
  incomeInputs: AnnualRoicInputs | null;
  beginningCapital: RoicCapital;
  endingCapital: RoicCapital;
  missingReasons: RoicIssue[];
  warnings: RoicIssue[];
}
export interface AnnualRoicHistory {
  policyVersion: typeof ANNUAL_ROIC_POLICY_VERSION;
  label: '年度报表口径参考 ROIC';
  currency: 'USD';
  rateUnit: 'decimal';
  taxBasis: 'historical-effective-tax-rate-proxy';
  capitalInputVersion: 2;
  assumptions: string[];
  results: AnnualRoicResult[];
  missingReasons: RoicIssue[];
}

export const QUARTERLY_ROIC_POLICY_VERSION = 'quarterly-roic-v1' as const;
export const QUARTERLY_ROIC_INPUT_VERSION = 'quarterly-roic-inputs-v1' as const;
export interface QuarterlyRoicInputs extends Omit<AnnualRoicInputs, 'version'> {
  version: typeof QUARTERLY_ROIC_INPUT_VERSION;
  fiscalQuarter: number;
  fiscalYearStart: string;
}
export interface QuarterlyRoicResult extends Omit<
  AnnualRoicResult,
  'policyVersion' | 'incomeInputs' | 'historicalEffectiveTaxRate'
> {
  policyVersion: typeof QUARTERLY_ROIC_POLICY_VERSION;
  fiscalQuarter: number;
  quarterlyEffectiveTaxRate: number | null;
  incomeInputs: QuarterlyRoicInputs | null;
}
export interface QuarterlyRoicHistory extends Omit<
  AnnualRoicHistory,
  'policyVersion' | 'label' | 'results' | 'taxBasis'
> {
  policyVersion: typeof QUARTERLY_ROIC_POLICY_VERSION;
  label: '单季度报表口径参考 ROIC';
  annualized: false;
  taxBasis: 'quarter-effective-tax-rate-proxy';
  results: QuarterlyRoicResult[];
}
/** Only the immediately preceding capital snapshot; never a recursively embedded history. */
export interface RoicBeginningSnapshot {
  version: 'roic-capital-snapshot-v1';
  cik: string | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodStart: string;
  periodEnd: string;
  currency: string | null;
  sources: {
    balanceSheetInputs: BalanceSheetInputs;
  };
}
