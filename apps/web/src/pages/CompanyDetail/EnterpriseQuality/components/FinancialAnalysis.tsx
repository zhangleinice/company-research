import type { ReactNode } from 'react';
import { Card, Empty, Space, Typography } from 'antd';
import type { CompanyDetail, FinancialMode } from '@company-research/shared';
import type { QualityResource } from '../hooks/useEnterpriseQuality.js';
import {
  ANALYSIS_MODULES,
  analysisPeriods,
} from '../../utils/financial-analysis.js';
import { GrowthSection } from '../Growth/index.js';
import { ProfitabilitySection } from '../Profitability/index.js';
import { CashFlowSection } from '../CashFlow/index.js';
import { FinancialHealthSection } from '../FinancialHealth/index.js';
import { ShareholderReturnsSection } from './ShareholderReturnsSection.js';
export function FinancialAnalysis({
  detail,
  mode,
  modules,
  growthDetails,
  quality,
}: {
  detail: Pick<CompanyDetail, 'annual' | 'quarterly'>;
  mode: FinancialMode;
  modules?: readonly (typeof ANALYSIS_MODULES)[number]['key'][];
  growthDetails?: ReactNode;
  quality?: QualityResource;
}) {
  const rows = analysisPeriods(detail, mode),
    latest = rows[0];
  const periodText = latest
    ? `${mode === 'annual' ? '完整财年' : '独立季度'} · ${latest.periodStart} 至 ${latest.periodEnd}`
    : '当前口径暂无可用报告期间';
  return (
    <Space orientation="vertical" size={24} className="full-width">
      {ANALYSIS_MODULES.filter(
        (module) => !modules || modules.includes(module.key),
      ).map((module) => (
        <section
          key={module.key}
          data-analysis-module={module.key}
          aria-labelledby={`analysis-${module.key}`}
        >
          <Card
            title={<span id={`analysis-${module.key}`}>{module.title}</span>}
            className="analysis-module"
          >
            <Typography.Paragraph className="analysis-period">
              {periodText} · 金额：百万美元 · 缺失数据：—
            </Typography.Paragraph>
            {!rows.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`暂无${mode === 'annual' ? '年度' : '独立季度'}财务数据`}
              />
            )}
            {rows.length > 0 && (
              <>
                {module.key === 'growth' && (
                  <GrowthSection rows={rows} latest={latest} mode={mode} />
                )}
                {module.key === 'profitability' && (
                  <ProfitabilitySection
                    rows={rows}
                    latest={latest}
                    mode={mode}
                    quality={quality}
                  />
                )}
                {module.key === 'cash-flow' && (
                  <CashFlowSection rows={rows} latest={latest} mode={mode} />
                )}
                {module.key === 'financial-health' && (
                  <FinancialHealthSection
                    rows={rows}
                    latest={latest}
                    mode={mode}
                  />
                )}
                {module.key === 'shareholder-returns' && (
                  <ShareholderReturnsSection
                    rows={rows}
                    latest={latest}
                    mode={mode}
                  />
                )}
              </>
            )}
            {module.key === 'growth' && growthDetails}
          </Card>
        </section>
      ))}
    </Space>
  );
}
