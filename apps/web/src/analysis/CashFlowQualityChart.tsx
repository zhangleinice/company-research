import { useState } from 'react';
import { Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';
type Selection = 'all' | 'fcfMargin' | 'cashConversionRatio';
export function cashFlowQualitySeries(selected: Selection): TrendSeries[] {
  const all: TrendSeries[] = [
    { key: 'fcfMargin', label: 'FCF Margin', color: '#389e6f' },
    {
      key: 'cashConversionRatio',
      label: 'Cash Conversion Ratio',
      color: '#1677ff',
    },
  ];
  return selected === 'all' ? all : all.filter((item) => item.key === selected);
}
export function CashFlowQualityChart({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const title = 'Cash Flow Quality Trends · 现金流质量趋势';
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
              ...cashFlowQualitySeries('all').map((item) => ({
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
          unit="percent"
          series={cashFlowQualitySeries(selected)}
          retainEmptyPeriods
        />
      </Space>
    </section>
  );
}
