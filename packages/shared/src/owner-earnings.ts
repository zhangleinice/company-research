export const OWNER_EARNINGS_POLICY = 'owner-earnings-ocf-v1';
export const OWNER_EARNINGS_INPUT_VERSION = 1;

export interface OwnerEarningsSource {
  approximate?: boolean;
  decimals?: number | 'INF';
  coefficient?: number;
  concept: string;
  unit: 'USD';
  start: string;
  end: string;
  accn: string;
  filed: string;
  form: string;
  val: number;
  url: string;
}
export interface OwnerEarningsFact {
  approximate?: boolean;
  calculation?: string;
  policyVersion?: string;
  value: number | null;
  reason: string | null;
  sources: OwnerEarningsSource[];
}
export interface OwnerEarningsInputs {
  version: 1;
  periodStart: string;
  periodEnd: string;
  depreciationAmortization: OwnerEarningsFact;
  sbc: OwnerEarningsFact;
}
export interface OwnerEarningsYear {
  fiscalYear: number | null;
  periodStart: string;
  periodEnd: string;
  currency: 'USD';
  dataVersion: string;
  netIncomeScope: 'parent' | 'consolidated' | 'unknown';
  netIncome: OwnerEarningsFact;
  operatingCashFlow: OwnerEarningsFact;
  depreciationAmortization: OwnerEarningsFact;
  capex: OwnerEarningsFact;
  fcf: OwnerEarningsFact;
  sbc: OwnerEarningsFact;
  revenue: OwnerEarningsFact;
  capexToRevenue: number | null;
  daToRevenue: number | null;
}
export interface OwnerEarningsDraft {
  periodStart: string;
  periodEnd: string;
  dataVersion: string;
  method: 'ratio' | 'amount';
  /** Percentage points, or USD millions respectively. No default assumption. */
  ratio: number | null;
  amount: number | null;
  comparable: boolean;
  rationale: string;
}
export interface OwnerEarningsEstimate extends OwnerEarningsDraft {
  cik: string;
  fiscalYear: number | null;
  capexBasis: number | null;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
}
export interface OwnerEarningsResults {
  maintenanceCapex: number | null;
  growthCapex: number | null;
  growthReason: string | null;
  ownerEarnings: number | null;
  sbcAdjustedOwnerEarnings: number | null;
}
export interface OwnerEarningsResponse {
  cik: string;
  ticker: string;
  policyVersion: string;
  history: OwnerEarningsYear[];
  estimate: OwnerEarningsEstimate | null;
  estimateStatus: 'none' | 'confirmed' | 'needs_reconfirmation';
  results: OwnerEarningsResults;
}

/** Current cached inputs plus transient results; never a saved research record. */
export interface OwnerEarningsPreview {
  data: OwnerEarningsResponse;
  results: OwnerEarningsResults;
}
