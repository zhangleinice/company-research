import { useState } from 'react';
import { Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';

type Selection = 'all' | 'operatingCashFlow' | 'capex' | 'fcf';
export function cashFlowSeries(selected: Selection): TrendSeries[] {
  const items: TrendSeries[] = [
    { key: 'operatingCashFlow', label: 'OCF', color: '#1677ff' },
    { key: 'capex', label: 'CapEx', color: '#d89614' },
    { key: 'fcf', label: 'FCF', color: '#389e6f' },
  ];
  return selected === 'all'
    ? items
    : items.filter((item) => item.key === selected);
}

export function CashFlowCharts({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const title = 'OCF / CapEx / FCF 历史趋势（亿美元）';
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <Space orientation="vertical" className="full-width" size={12}>
        <div className="health-chart-filter">
          <Segmented
            aria-label={title}
            value={selected}
            options={[
              { label: '全部对比', value: 'all' },
              ...cashFlowSeries('all').map((item) => ({
                label: item.label,
                value: item.key,
              })),
            ]}
            onChange={(value) => setSelected(value as Selection)}
          />
        </div>
        <FinancialTrendChart
          title={title}
          rows={rows}
          mode={mode}
          unit="money"
          moneyDivisor={1e8}
          moneyUnit="亿美元"
          series={cashFlowSeries(selected)}
        />
      </Space>
    </section>
  );
}
