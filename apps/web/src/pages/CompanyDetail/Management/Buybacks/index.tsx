import { Card, Space, Typography } from 'antd';

import { ShareholderReturnsChart } from '../../components/financial/ShareholderReturnsChart.js';
import { METRICS } from '../../utils/financial-analysis.js';
import { AllocationCards } from '../components/AllocationCards.js';

import { unknown } from '../utils/missing-allocation.js';
import type { ManagementModuleProps } from '../types.js';
export function BuybacksModule({
  rows,
  latest,
  period,
}: ManagementModuleProps) {
  const allocation = latest?.capitalAllocation;
  const unavailable = latest
    ? '接口未返回资本配置来源，请检查后端版本'
    : '暂无完整年度财务数据';
  const shares = allocation?.sharesOutstanding ?? unknown(unavailable);
  const buyback = allocation?.buybackToFcf ?? unknown(unavailable);
  return (
    <section data-analysis-module="repurchases">
      <Card className="analysis-module" title="Share Repurchases · 股票回购">
        <Typography.Paragraph className="analysis-period">
          {period}
        </Typography.Paragraph>
        <Space orientation="vertical" size={24} className="full-width">
          <AllocationCards
            items={[
              {
                key: 'stockRepurchases',
                label: 'Stock Repurchases · 股票回购金额',
                value: latest?.stockRepurchases ?? null,
                sources: allocation?.references.stockRepurchases,
                unit: 'money',
                description: METRICS.stockRepurchases.description,
              },
              {
                key: 'dilutedSharesGrowth',
                label: 'Diluted Shares YoY · 稀释股数同比',
                value: latest?.dilutedSharesGrowth ?? null,
                sources: allocation?.references.dilutedSharesGrowth,
                unit: 'percent',
                description: METRICS.dilutedSharesGrowth.description,
              },
              {
                key: 'sharesOutstanding',
                label: 'Shares Outstanding · 期末流通股数',
                ...shares,
                unit: 'shares',
                description:
                  '对应财年末的普通股总量，不是期间稀释加权平均股数；不叠加股份类别明细或封面其他日期股数。',
              },
              {
                key: 'buybackToFcf',
                label: 'Buyback / FCF · 回购占自由现金流',
                ...buyback,
                unit: 'percent',
                description:
                  '同一完整财年普通股回购现金支出 ÷ FCF × 100%；FCF = OCF − CapEx，且必须大于零。超过100%不截断。',
              },
            ]}
          />
          <ShareholderReturnsChart rows={rows} mode="annual" />
        </Space>
      </Card>
    </section>
  );
}
