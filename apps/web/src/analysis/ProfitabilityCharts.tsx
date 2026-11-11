import { useState } from 'react';
import { Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';

type Selection = 'all' | 'gross' | 'operating' | 'net';
export function profitabilitySeries(selected: Selection): TrendSeries[] {
  const margins: TrendSeries[] = [
    { key: 'grossMargin', label: 'Gross Margin', color: '#1677ff' },
    { key: 'operatingMargin', label: 'Operating Margin', color: '#389e6f' },
    { key: 'netMargin', label: 'Net Margin', color: '#9254de' },
  ];
  const items = margins;
  return selected === 'all'
    ? items
    : [items[['gross', 'operating', 'net'].indexOf(selected)]];
}

export function ProfitabilityCharts({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const all = profitabilitySeries('all');
  const title = '利润率历史趋势';
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <Space orientation="vertical" className="full-width" size={12}>
        <Segmented
          aria-label={title}
          block
          value={selected}
          options={[
            { label: '全部对比', value: 'all' },
            ...all.map((item, index) => ({
              label: item.label,
              value: ['gross', 'operating', 'net'][index],
            })),
          ]}
          onChange={(value) => setSelected(value as Selection)}
          style={{ maxWidth: '100%', overflowX: 'auto' }}
        />
        <FinancialTrendChart
          title={title}
          rows={rows}
          mode={mode}
          unit="percent"
          series={profitabilitySeries(selected)}
        />
      </Space>
    </section>
  );
}
