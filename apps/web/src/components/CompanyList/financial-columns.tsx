import type { FinancialMode, FinancialPeriod } from '@company-research/shared';
import { Typography, type TableColumnsType } from 'antd';

export const amount = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(
        value / 1000000,
      );
export const number = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const percent = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toFixed(2)}%`;
export const periodLabel = (row: FinancialPeriod, mode: FinancialMode) =>
  mode === 'annual'
    ? `${row.fiscalYear ?? '—'}`
    : `${row.fiscalYear ?? '—'} Q${row.fiscalQuarter ?? '—'}`;

export function financialColumns(
  mode: FinancialMode,
): TableColumnsType<FinancialPeriod> {
  const col = (
    title: string,
    key: keyof FinancialPeriod,
    format = amount,
  ): TableColumnsType<FinancialPeriod>[number] => ({
    title,
    key,
    width: 140,
    align: 'right',
    render: (_value, row) => format(row[key] as number | null),
  });
  const beginning: TableColumnsType<FinancialPeriod> = [
    {
      title: '期间',
      key: 'period',
      fixed: 'left',
      width: 150,
      render: (_value, row) => (
        <>
          <Typography.Text>{periodLabel(row, mode)}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{row.periodEnd}</Typography.Text>
        </>
      ),
    },
    col('Revenue', 'revenue'),
    col(
      mode === 'annual' ? 'Revenue Growth' : 'Revenue YoY',
      'revenueGrowth',
      percent,
    ),
  ];
  if (mode === 'quarterly')
    return [
      ...beginning,
      col('Operating Income', 'operatingIncome'),
      col('Net Income', 'netIncome'),
      col('Diluted EPS', 'eps', number),
      col('EPS YoY', 'epsGrowth', percent),
      col('Operating Margin', 'operatingMargin', percent),
      col('Cash', 'cash'),
      col('Total Debt', 'totalDebt'),
    ];
  return [
    ...beginning,
    col('Diluted EPS', 'eps', number),
    col('EPS Growth', 'epsGrowth', percent),
    col('FCF', 'fcf'),
    col('FCF Growth', 'fcfGrowth', percent),
    col('Gross Margin', 'grossMargin', percent),
    col('Operating Margin', 'operatingMargin', percent),
    col('Net Margin', 'netMargin', percent),
    col('ROE', 'roe', percent),
    col('Cash', 'cash'),
    col('Total Debt', 'totalDebt'),
    col('Shares Outstanding', 'sharesOutstanding', number),
    col('Book Value / Share', 'bookValuePerShare', number),
  ];
}
