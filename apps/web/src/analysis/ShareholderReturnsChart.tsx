import { useState } from 'react';
import { Segmented, Space, Typography } from 'antd';
import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import { FinancialTrendChart } from './FinancialTrendChart.js';

export type RepurchaseTrendSelection = 'stockRepurchases' | 'dilutedShares';
export function repurchaseTrend(selected: RepurchaseTrendSelection) {
  return selected === 'stockRepurchases'
    ? {
        key: selected,
        label: 'Stock Repurchases',
        unit: 'money' as const,
        unitLabel: '百万美元',
        color: '#1677ff',
      }
    : {
        key: selected,
        label: 'Diluted Shares',
        unit: 'shares' as const,
        unitLabel: '百万股',
        color: '#389e0d',
      };
}

export function ShareholderReturnsChart({
  rows,
  mode,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
}) {
  const [selected, setSelected] =
    useState<RepurchaseTrendSelection>('stockRepurchases');
  const trend = repurchaseTrend(selected);
  const title = '股票回购与股份变化趋势';
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <Space orientation="vertical" className="full-width" size={12}>
        <div className="health-chart-filter">
          <Segmented
            aria-label={title}
            value={selected}
            options={[
              {
                label: 'Stock Repurchases（回购金额）',
                value: 'stockRepurchases',
              },
              { label: 'Diluted Shares（稀释股数）', value: 'dilutedShares' },
            ]}
            onChange={(value) => setSelected(value as RepurchaseTrendSelection)}
          />
        </div>
        <Typography.Text type="secondary">
          单位：{trend.unitLabel}
        </Typography.Text>
        <FinancialTrendChart
          title={`${title}（${trend.unitLabel}）`}
          rows={rows}
          mode={mode}
          series={[trend]}
          unit={trend.unit}
          moneyDivisor={1e6}
          moneyUnit="百万美元"
        />
      </Space>
    </section>
  );
}
