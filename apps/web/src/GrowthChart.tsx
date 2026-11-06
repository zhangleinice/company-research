import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import { FinancialTrendChart } from './analysis/FinancialTrendChart.js';

/** Existing chart entry point, now using the common responsive financial chart. */
export function GrowthChart({
  rows,
  mode,
  includeFcf = true,
}: {
  rows: FinancialPeriod[];
  mode: FinancialMode;
  includeFcf?: boolean;
}) {
  return (
    <FinancialTrendChart
      title="Revenue / EPS 同比趋势"
      rows={rows}
      mode={mode}
      unit="percent"
      series={[
        { key: 'revenueGrowth', label: 'Revenue YoY', color: '#1677ff' },
        { key: 'epsGrowth', label: 'EPS YoY', color: '#389e6f' },
        ...(includeFcf
          ? [{ key: 'fcfGrowth' as const, label: 'FCF YoY', color: '#9254de' }]
          : []),
      ]}
    />
  );
}
