import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import type { QualityResource } from './hooks/useEnterpriseQuality.js';
export interface QualitySectionProps {
  rows: FinancialPeriod[];
  latest: FinancialPeriod | undefined;
  mode: FinancialMode;
  quality?: QualityResource;
}
