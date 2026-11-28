import type { MultipleYear, GrowthReference } from '@company-research/shared';
/** Display only; never feed formatted amounts back into a valuation. */
export const valuationNumber = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
export const valuationPercent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${valuationNumber(n)}%`;
export const multipleValueFormula = (
  eps: number | null,
  pe: number | null,
  value: number | null,
) =>
  `${valuationNumber(eps)} × ${valuationNumber(pe)} ≈ ${valuationNumber(value)} 美元/股`;
export const justifiedPeFormula = (
  roe: number | null,
  g: number | null,
  ke: number | null,
  pe: number | null,
) =>
  `(1 − ${valuationPercent(g)} / ${valuationPercent(roe)}) × (1 + ${valuationPercent(g)}) / (${valuationPercent(ke)} − ${valuationPercent(g)}) ≈ ${valuationNumber(pe)}x`;
export function epsCagrFormula(
  years: MultipleYear[],
  n: 3 | 5,
  value: number | null,
) {
  const rows = [...years].sort((a, b) => b.end.localeCompare(a.end)),
    a = rows[0],
    b = rows[n];
  return `FY${b?.year ?? '—'} ${valuationNumber(b?.eps.value)} → FY${a?.year ?? '—'} ${valuationNumber(a?.eps.value)}；(${valuationNumber(a?.eps.value)} / ${valuationNumber(b?.eps.value)})^(1/${n}) − 1 ≈ ${valuationPercent(value === null ? null : value * 100)}`;
}
export function simpleCagrFormula(
  growth: GrowthReference,
  metric: 'fcf' | 'revenue',
) {
  const first = growth.points[0],
    last = growth.points.at(-1);
  return `FY${first?.year ?? '—'} ${valuationNumber(first?.[metric] == null ? null : first[metric]! / 1e6)} → FY${last?.year ?? '—'} ${valuationNumber(last?.[metric] == null ? null : last[metric]! / 1e6)}（百万美元）；CAGR ≈ ${valuationPercent(growth.value === null ? null : growth.value * 100)}（${growth.years}年间隔）`;
}
