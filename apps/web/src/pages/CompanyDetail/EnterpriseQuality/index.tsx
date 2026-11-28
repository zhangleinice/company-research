import { Space, Segmented, Typography } from 'antd';
import type { CompanyDetail, FinancialMode } from '@company-research/shared';
import { useEnterpriseQuality } from './hooks/useEnterpriseQuality.js';
import { RevenueBreakdown } from './Growth/components/RevenueBreakdown.js';
import { FinancialAnalysis } from './components/FinancialAnalysis.js';
/** Period state remains in CompanyDetails; hidden tabs keep their child state. */
export function CompanyQualityContent({
  detail,
  mode,
  onModeChange,
  revision = 0,
}: {
  detail: CompanyDetail;
  mode: FinancialMode;
  onModeChange: (mode: FinancialMode) => void;
  revision?: number;
}) {
  const quality = useEnterpriseQuality(detail.ticker, revision);
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <div className="analysis-mode-controls">
        <Segmented
          aria-label="财务报告期间口径"
          value={mode}
          options={[
            { label: 'Annual', value: 'annual' },
            { label: 'Quarterly', value: 'quarterly' },
          ]}
          onChange={(value) => onModeChange(value as FinancialMode)}
        />
        <Typography.Text type="secondary">
          {mode === 'annual' ? '最近 10 个完整财年' : '最近 10 个独立季度'}
        </Typography.Text>
      </div>

      <FinancialAnalysis
        detail={detail}
        mode={mode}
        quality={quality}
        modules={['growth', 'profitability', 'cash-flow', 'financial-health']}
        growthDetails={
          <RevenueBreakdown
            key={detail.cik}
            cik={detail.cik}
            revision={revision}
          />
        }
      />
    </Space>
  );
}
