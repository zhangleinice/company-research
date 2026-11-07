import { useState } from 'react';
import { Col, Row, Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';

type Kind = 'cash' | 'quality';
type Selection = 'all' | 'operatingCashFlow' | 'capex' | 'fcf' | 'netIncome';
export function cashFlowSeries(kind: Kind, selected: Selection): TrendSeries[] {
  const items: TrendSeries[] =
    kind === 'cash'
      ? [
          { key: 'operatingCashFlow', label: 'OCF', color: '#1677ff' },
          { key: 'capex', label: 'CapEx', color: '#d89614' },
          { key: 'fcf', label: 'FCF', color: '#389e6f' },
        ]
      : [
          { key: 'netIncome', label: 'Net Income', color: '#9254de' },
          { key: 'operatingCashFlow', label: 'OCF', color: '#1677ff' },
        ];
  return selected === 'all'
    ? items
    : items.filter((item) => item.key === selected);
}

function CashChart({
  rows,
  mode,
  kind,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
  kind: Kind;
}) {
  const [selected, setSelected] = useState<Selection>('all');
  const title =
    kind === 'cash'
      ? 'OCF / CapEx / FCF 历史趋势（亿美元）'
      : '利润与经营现金流对比（亿美元）';
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <Space orientation="vertical" className="full-width" size={12}>
        <Segmented
          aria-label={title}
          value={selected}
          options={[
            { label: kind === 'cash' ? '全部对比' : '两者对比', value: 'all' },
            ...cashFlowSeries(kind, 'all').map((item) => ({
              label: item.label,
              value: item.key,
            })),
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
          series={cashFlowSeries(kind, selected)}
        />
      </Space>
    </section>
  );
}

export function CashFlowCharts({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} xl={12}>
        <CashChart rows={rows} mode={mode} kind="cash" />
      </Col>
      <Col xs={24} xl={12}>
        <CashChart rows={rows} mode={mode} kind="quality" />
      </Col>
    </Row>
  );
}
