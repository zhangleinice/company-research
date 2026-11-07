import { useState } from 'react';
import { Col, Row, Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';

type Selection = 'all' | 'gross' | 'operating' | 'net';
export function profitabilitySeries(
  kind: 'margin' | 'profit',
  selected: Selection,
): TrendSeries[] {
  const margins: TrendSeries[] = [
    { key: 'grossMargin', label: 'Gross Margin', color: '#1677ff' },
    { key: 'operatingMargin', label: 'Operating Margin', color: '#389e6f' },
    { key: 'netMargin', label: 'Net Margin', color: '#9254de' },
  ];
  const profits: TrendSeries[] = [
    { key: 'grossProfit', label: 'Gross Profit', color: '#1677ff' },
    { key: 'operatingIncome', label: 'Operating Income', color: '#389e6f' },
    { key: 'netIncome', label: 'Net Income', color: '#9254de' },
  ];
  const items = kind === 'margin' ? margins : profits;
  return selected === 'all'
    ? items
    : [items[['gross', 'operating', 'net'].indexOf(selected)]];
}

function ProfitChart({
  rows,
  mode,
  kind,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
  kind: 'margin' | 'profit';
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const all = profitabilitySeries(kind, 'all');
  const title = kind === 'margin' ? '利润率历史趋势' : '利润历史变化（亿美元）';
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
          unit={kind === 'margin' ? 'percent' : 'money'}
          moneyDivisor={100000000}
          moneyUnit="亿美元"
          series={profitabilitySeries(kind, selected)}
        />
      </Space>
    </section>
  );
}

export function ProfitabilityCharts({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} xl={12}>
        <ProfitChart rows={rows} mode={mode} kind="margin" />
      </Col>
      <Col xs={24} xl={12}>
        <ProfitChart rows={rows} mode={mode} kind="profit" />
      </Col>
    </Row>
  );
}
