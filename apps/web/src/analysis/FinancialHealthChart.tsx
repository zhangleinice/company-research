import { useState } from 'react';
import { Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';

type Selection = 'all' | 'cash' | 'totalDebt';
export function healthSeries(selected: Selection): TrendSeries[] {
  const all: TrendSeries[] = [
    { key: 'cash', label: 'Cash', color: '#1677ff' },
    { key: 'totalDebt', label: 'Total Debt', color: '#d89614' },
  ];
  return selected === 'all' ? all : all.filter((item) => item.key === selected);
}
export function FinancialHealthChart({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const title = '现金储备与债务历史趋势（亿美元）';
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <Space orientation="vertical" className="full-width" size={12}>
        <Segmented
          aria-label={title}
          value={selected}
          options={[
            { label: '全部对比', value: 'all' },
            { label: 'Cash', value: 'cash' },
            { label: 'Total Debt', value: 'totalDebt' },
          ]}
          onChange={(value) => setSelected(value as Selection)}
        />
        <FinancialTrendChart
          title={title}
          rows={rows}
          mode={mode}
          unit="money"
          moneyDivisor={1e8}
          moneyUnit="亿美元"
          series={healthSeries(selected)}
        />
      </Space>
    </section>
  );
}
