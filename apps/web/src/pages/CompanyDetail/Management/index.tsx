import { Space } from 'antd';
import type { CompanyDetail } from '@company-research/shared';
import type { CachedResearch } from '../hooks/useCachedResearch.js';
import { managementPeriods } from './utils/management-periods.js';
import { CapitalAllocationOverview } from './CapitalAllocation/index.js';
import { DividendsModule } from './Dividends/index.js';
import { BuybacksModule } from './Buybacks/index.js';
import { ReinvestmentModule } from './Reinvestment/index.js';
import { AcquisitionsModule } from './Acquisitions/index.js';
import { DebtFinancingModule } from './DebtFinancing/index.js';
export function ManagementAnalysis({
  detail,
  research,
  updating = false,
}: {
  detail: Pick<CompanyDetail, 'annual'>;
  research?: CachedResearch;
  updating?: boolean;
}) {
  const rows = managementPeriods(detail),
    latest = rows[0];
  const period = latest
    ? `${latest.fiscalYear ?? ''} 财年 · ${latest.periodStart} 至 ${latest.periodEnd}`
    : '暂无完整年度财务数据';
  return (
    <Space orientation="vertical" size={24} className="full-width">
      <CapitalAllocationOverview rows={rows} />
      <DividendsModule
        rows={rows}
        latest={latest}
        period={period}
        research={research}
        updating={updating}
      />
      <BuybacksModule
        rows={rows}
        latest={latest}
        period={period}
        research={research}
        updating={updating}
      />
      <ReinvestmentModule
        rows={rows}
        latest={latest}
        period={period}
        research={research}
        updating={updating}
      />
      <AcquisitionsModule
        rows={rows}
        latest={latest}
        period={period}
        research={research}
        updating={updating}
      />
      <DebtFinancingModule
        rows={rows}
        latest={latest}
        period={period}
        research={research}
        updating={updating}
      />
    </Space>
  );
}
