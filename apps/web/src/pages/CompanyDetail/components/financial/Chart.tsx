import { Typography } from 'antd';
import type { FinancialPeriod, FinancialMode } from '@company-research/shared';
import {
  FinancialTrendChart,
  type TrendSeries,
} from './FinancialTrendChart.js';
export function Chart({
  title,
  rows,
  mode,
  series,
  unit = 'money',
  moneyDivisor,
  moneyUnit,
}: {
  title: string;
  rows: FinancialPeriod[];
  mode: FinancialMode;
  series: TrendSeries[];
  unit?: 'money' | 'percent' | 'shares' | 'perShare';
  moneyDivisor?: number;
  moneyUnit?: string;
}) {
  return (
    <section className="analysis-chart-panel">
      <Typography.Title level={5}>{title}</Typography.Title>
      <FinancialTrendChart
        title={title}
        rows={rows}
        mode={mode}
        series={series}
        unit={unit}
        moneyDivisor={moneyDivisor}
        moneyUnit={moneyUnit}
      />
    </section>
  );
}
