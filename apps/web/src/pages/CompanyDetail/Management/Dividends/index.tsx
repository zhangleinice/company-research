import { Card, Empty, Space, Typography } from 'antd';
import { Chart } from '../../components/financial/Chart.js';

import { METRICS } from '../../utils/financial-analysis.js';
import { AllocationCards } from '../components/AllocationCards.js';

import { unknown } from '../utils/missing-allocation.js';
import type { ManagementModuleProps } from '../types.js';
export function DividendsModule({
  rows,
  latest,
  period,
}: ManagementModuleProps) {
  const allocation = latest?.capitalAllocation;
  const unavailable = latest
    ? '接口未返回资本配置来源，请检查后端版本'
    : '暂无完整年度财务数据';
  const paid = allocation?.dividendsPaid ?? unknown(unavailable);
  const payout = allocation?.payoutRatio ?? unknown(unavailable);
  return (
    <section data-analysis-module="dividends">
      <Card className="analysis-module" title="Dividends · 股息分红">
        <Typography.Paragraph className="analysis-period">
          {period}
        </Typography.Paragraph>
        {!rows.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无年度财务数据"
          />
        )}
        <Space orientation="vertical" size={24} className="full-width">
          <AllocationCards
            items={[
              {
                key: 'dividendsPerShare',
                label: 'DPS · 每股股息',
                value: latest?.dividendsPerShare ?? null,
                sources: allocation?.references.dividendsPerShare,
                unit: 'perShare',
                description: METRICS.dividendsPerShare.description,
              },
              {
                key: 'dpsGrowth',
                label: 'DPS YoY · 每股股息同比',
                value: latest?.dpsGrowth ?? null,
                sources: allocation?.references.dpsGrowth,
                unit: 'percent',
                description: METRICS.dpsGrowth.description,
              },
              {
                key: 'dividendsPaid',
                label: 'Cash Dividends Paid · 现金分红',
                ...paid,
                unit: 'money',
                description: METRICS.dividendsPaid.description,
                reason:
                  paid.reason ??
                  (allocation?.dividendsPaid.scope === 'total'
                    ? 'SEC总股息支付额，非普通股专属口径'
                    : '普通股现金分红'),
              },
              {
                key: 'payoutRatio',
                label: 'Dividend Payout Ratio · 股息支付率',
                ...payout,
                unit: 'percent',
                description:
                  '同一完整财年普通股现金分红 ÷ 普通股股东可得净利润 × 100%。归属未核准或净利润不大于零时不计算。',
              },
            ]}
          />
          <Chart
            title="Dividends Per Share Trend · 每股股息趋势（美元/股）"
            rows={rows}
            mode="annual"
            unit="perShare"
            series={[
              {
                key: 'dividendsPerShare',
                label: 'Declared DPS',
                color: '#1677ff',
              },
            ]}
          />
        </Space>
      </Card>
    </section>
  );
}
