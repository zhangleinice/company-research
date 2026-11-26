import type { ValuationFact } from './dcf.js';
export const OPERATING_NWC_POLICY = 'cashflow-operating-nwc-v1';
export type NwcItemStatus =
  | 'INCLUDED'
  | 'EXCLUDED'
  | 'UNRESOLVED'
  | 'MISSING'
  | 'CONFLICT'
  | 'NOT_APPLICABLE';
export interface OperatingNwcItem {
  category: string;
  label: string;
  status: NwcItemStatus;
  cashImpact: number | null;
  reason: string;
  /** Unavailable annual/TTM legs stay explicit, never zero-filled. */
  missingLegs: string[];
  sources: Record<string, unknown>[];
}
/** Raw USD values; defaultValue alone is eligible for future automatic use.
 * partialValue is an incomplete research reference and must not become FCFF input. */
export interface OperatingWorkingCapital {
  policyVersion: typeof OPERATING_NWC_POLICY;
  cik: string;
  unit: 'USD';
  periodKind: 'ANNUAL' | 'TTM';
  periodStart: string | null;
  periodEnd: string;
  status: 'COMPLETE' | 'APPROXIMATE' | 'PARTIAL' | 'MISSING' | 'CONFLICT';
  identifiedCashImpact: number | null;
  operatingCash: {
    ratio: number;
    revenue: ValuationFact;
    priorRevenue: ValuationFact;
    increment: number | null;
    formula: string;
    reason: string | null;
  };
  completeValue: number | null;
  approximateValue: number | null;
  partialValue: number | null;
  defaultValue: number | null;
  requiresUserAdjustment: boolean;
  coverageAssessment?: NwcCoverageAssessment;
  items: OperatingNwcItem[];
  balanceSheetCheck?: {
    scope: string;
    change: number | null;
    comparableCashFlowChange: number | null;
    difference: number | null;
    sources: Record<string, unknown>[];
    reason: string;
  };
  warnings: string[];
  calculation: string;
}
export interface NwcScopeQualification {
  cik: string;
  accession: string;
  concept: string;
  classification: 'OPERATING' | 'EXCLUDED';
  evidence: string;
}
/** Only trusted, source-backed assessments may certify coverage. No numeric
 * threshold silently upgrades unidentified/mixed balances to immaterial items. */
export interface NwcCoverageAssessment {
  cik: string;
  start: string;
  end: string;
  accessions: string[];
  status: 'COMPLETE' | 'REPRESENTATIVE';
  evidence: string;
  omissions: Array<{
    category: string;
    treatment: 'NOT_APPLICABLE' | 'IMMATERIAL';
    evidence: string;
  }>;
}
