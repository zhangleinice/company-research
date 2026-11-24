import { useState } from 'react';
import { Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';
type Selection = 'all' | 'currentRatio' | 'debtToEquity' | 'interestCoverage';
export function financialRatioSeries(selected: Selection): TrendSeries[] {
  const all: TrendSeries[] = [
    { key: 'currentRatio', label: 'Current Ratio', color: '#1677ff' },
    { key: 'debtToEquity', label: 'Debt / Equity', color: '#389e6f' },
    { key: 'interestCoverage', label: 'Interest Coverage', color: '#d89614' },
  ];
  return selected === 'all' ? all : all.filter((item) => item.key === selected);
}
export function FinancialRatioChart({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const title = 'Financial Ratio Trends · 财务比率趋势';
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
              ...financialRatioSeries('all').map((item) => ({
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
          unit="multiple"
          series={financialRatioSeries(selected)}
          retainEmptyPeriods
        />
      </Space>
    </section>
  );
}
