import type { FinancialPeriod } from '@company-research/shared';
import type { CachedResearch } from '../hooks/useCachedResearch.js';
export interface ManagementModuleProps {
  rows: FinancialPeriod[];
  latest: FinancialPeriod | undefined;
  period: string;
  research?: CachedResearch;
  updating?: boolean;
}
