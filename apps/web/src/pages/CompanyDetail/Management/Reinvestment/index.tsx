import { Card, Space, Typography } from 'antd';
import { Chart } from '../../components/financial/Chart.js';

import { AllocationCards } from '../components/AllocationCards.js';
import {
  CapitalSource,
  CapitalNotes,
  capitalInformation,
} from '../components/CapitalAllocationResearch.js';
import { unknown } from '../utils/missing-allocation.js';
import type { ManagementModuleProps } from '../types.js';
export function ReinvestmentModule({
  rows,
  latest,
  period,
  research,
  updating = false,
}: ManagementModuleProps) {
  const reinvestment = latest?.capitalAllocation?.reinvestment;
  const { info } = capitalInformation(research);
  return (
    <section data-analysis-module="reinvestment">
      <Card className="analysis-module" title="Business Investment · 业务投资">
        <Space orientation="vertical" size={24} className="full-width">
          <Typography.Text type="secondary">{period}</Typography.Text>
          <AllocationCards
            columns={3}
            items={[
              {
                key: 'capex',
                label: 'CapEx · 资本支出',
                ...(reinvestment?.capex ?? unknown('缺少可靠年度CapEx')),
                unit: 'money',
                description:
                  'SEC已披露的年度购建固定资产现金支出，不等于维持性CapEx。',
              },
              {
                key: 'capexToOcf',
                label: 'CapEx / OCF',
                ...(reinvestment?.capexToOcf ??
                  unknown('缺少同财年CapEx及OCF')),
                unit: 'percent',
                description: '完整财年CapEx ÷ OCF × 100%，OCF必须大于零。',
              },
              {
                key: 'capexToRevenue',
                label: 'CapEx / Revenue',
                ...(reinvestment?.capexToRevenue ??
                  unknown('缺少同财年CapEx及Revenue')),
                unit: 'percent',
                description:
                  '完整财年CapEx ÷ Revenue × 100%，Revenue必须大于零。',
              },
            ]}
          />
          <Chart
            title="CapEx Trend · 资本支出趋势（百万美元）"
            rows={rows.map((r) => ({
              ...r,
              capex: r.capitalAllocation?.reinvestment?.capex.value ?? null,
            }))}
            mode="annual"
            series={[{ key: 'capex', label: 'CapEx', color: '#1677ff' }]}
            moneyDivisor={1e6}
            moneyUnit="百万美元"
          />
          <CapitalSource research={research} updating={updating} />
          <CapitalNotes
            research={research}
            groups={[
              {
                key: 'investmentAreas',
                title: '主要投资方向与项目',
                notes: info?.reinvestment.investmentAreas ?? [],
              },
              {
                key: 'investmentPurposes',
                title: '投资目的',
                notes: info?.reinvestment.investmentPurposes ?? [],
              },
              {
                key: 'investmentPlans',
                title: '未来投资计划',
                notes: info?.reinvestment.investmentPlans ?? [],
              },
              {
                key: 'investmentRisks',
                title: '投资相关风险',
                notes: info?.reinvestment.investmentRisks ?? [],
              },
            ]}
          />
        </Space>
      </Card>
    </section>
  );
}
