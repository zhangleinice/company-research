import type {
  CapitalAllocationOverview,
  AllocationSource,
} from '@company-research/shared';
import {
  capitalFundsRatio,
  capitalNodeColor,
} from './capital-sankey-options.js';

export interface CoverageItem {
  key: string;
  name: string;
  value: number | null;
  ratio: number | null;
  color: string;
  note: string;
  sources: AllocationSource[];
}
export function ocfCoverage(overview: CapitalAllocationOverview | undefined) {
  const ocf =
    overview?.ocf != null && Number.isFinite(overview.ocf)
      ? overview.ocf
      : null;
  const items: CoverageItem[] = [
    ['capex', '资本支出'],
    ['stockRepurchases', '股票回购'],
    ['dividendsPaid', '股息分红'],
    ['acquisitions', '收购及相关投资'],
  ].map(([key, name]) => {
    const matches = overview?.items.filter((i) => i.key === key) ?? [];
    const fact = matches.length === 1 ? matches[0] : undefined;
    const value =
      fact?.value != null &&
      Number.isFinite(fact.value) &&
      fact.value >= 0 &&
      fact.direction === 'outflow'
        ? fact.value
        : null;
    return {
      key,
      name,
      value,
      ratio: value === null ? null : capitalFundsRatio(value, ocf),
      color: capitalNodeColor({ key }),
      note: fact?.note ?? '该项支出未披露或范围无法确认，不视为零。',
      sources: fact?.sources ?? [],
    };
  });
  const complete = items.every((i) => i.value !== null);
  const identifiedSpending = items
    .filter((i) => i.value !== null)
    .reduce((sum, i) => sum + i.value!, 0);
  const remainder = complete && ocf !== null ? ocf - identifiedSpending : null;
  const insufficient = ocf !== null && ocf > 0 && identifiedSpending > ocf;
  const canPie =
    complete && ocf !== null && ocf > 0 && remainder !== null && remainder >= 0;
  items.push({
    key: 'remainder',
    name: '扣除上述支出后余额',
    value: remainder,
    ratio: remainder === null ? null : capitalFundsRatio(remainder, ocf),
    color: '#859baa',
    note: '余额 = 经营现金流 − 资本支出 − 股票回购 − 股息分红 − 收购及相关投资；仅为核心支出覆盖分析，不代表实际留存现金。',
    sources: [
      ...(overview?.items.find((i) => i.key === 'operatingCashFlow')?.sources ??
        []),
      ...items.flatMap((i) => i.sources),
    ],
  });
  return {
    ocf,
    items,
    complete,
    identifiedSpending,
    remainder,
    insufficient,
    canPie,
  };
}
