import { useState } from 'react';
import { Segmented, Space } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import { FinancialTrendChart } from './analysis/FinancialTrendChart.js';

export function growthSeries(
  visible: 'both' | 'revenue' | 'eps',
  includeFcf = false,
) {
  return [
    ...(visible !== 'eps'
      ? [
          {
            key: 'revenueGrowth' as const,
            label: 'Revenue YoY',
            color: '#1677ff',
          },
        ]
      : []),
    ...(visible !== 'revenue'
      ? [{ key: 'epsGrowth' as const, label: 'EPS YoY', color: '#389e6f' }]
      : []),
    ...(includeFcf && visible === 'both'
      ? [{ key: 'fcfGrowth' as const, label: 'FCF YoY', color: '#9254de' }]
      : []),
  ];
}

export function GrowthChart({
  rows,
  mode,
  includeFcf = true,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
  includeFcf?: boolean;
}) {
  const [visible, setVisible] = useState<'both' | 'revenue' | 'eps'>('both');
  return (
    <Space orientation="vertical" className="full-width" size={12}>
      <Segmented
        aria-label="增长率图表指标"
        value={visible}
        options={[
          { label: '两者对比', value: 'both' },
          { label: 'Revenue YoY', value: 'revenue' },
          { label: 'EPS YoY', value: 'eps' },
        ]}
        onChange={(value) => setVisible(value as typeof visible)}
      />
      <FinancialTrendChart
        title="Revenue / EPS 同比趋势"
        rows={rows}
        mode={mode}
        unit="percent"
        series={growthSeries(visible, includeFcf)}
      />
    </Space>
  );
}
