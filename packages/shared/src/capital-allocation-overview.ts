import type { AllocationSource } from './index.js';
export const CAPITAL_OVERVIEW_POLICY = 'capital-allocation-overview-v1';
export interface CapitalFlowFact {
  /** Direct main cash-flow statement line, not an unclassified note fact. */
  statement?: boolean;
  concept: string;
  value: number;
  start: string;
  end: string;
  accessionNumber: string;
  filed: string;
  url: string;
  unit: 'USD';
}
export interface CapitalFlowCache {
  version: typeof CAPITAL_OVERVIEW_POLICY;
  cik: string;
  facts: CapitalFlowFact[];
}
export interface CapitalOverviewItem {
  key: string;
  label: string;
  group: 'operations' | 'financing' | 'other';
  value: number | null;
  ratio: number | null;
  direction: 'inflow' | 'outflow' | 'net' | 'unknown';
  note: string;
  sources: AllocationSource[];
}
export interface CapitalAllocationOverview {
  version: typeof CAPITAL_OVERVIEW_POLICY;
  start: string;
  end: string;
  ocf: number | null;
  items: CapitalOverviewItem[];
  reconciliation: {
    sources: AllocationSource[];
    status: 'MATCHED' | 'INCOMPLETE' | 'CONFLICT';
    operating: number | null;
    investing: number | null;
    financing: number | null;
    fx: number | null;
    cashChange: number | null;
    difference: number | null;
    note: string;
  };
}
