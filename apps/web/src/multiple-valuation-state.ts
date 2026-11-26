import {
  epsGrowth,
  historicalRoe,
  justifiedPe,
  multipleIndustry,
  peValue,
  pegPe,
  type MultipleInputs,
  type IndustryPeData,
  type IndustryWaccData,
} from '@company-research/shared';
export interface MultipleSettings {
  /** Undefined selects an available default; explicit user choices never auto-switch. */
  epsBasis?: 'ttm' | 'annual' | 'manual';
  manualEps: number | null;
  peMethod: 'industry' | 'justified' | 'manual';
  industry?: string;
  overrides: Partial<Record<'pe' | 'roe' | 'g' | 'ke', number | null>>;
  growthMethod: '5' | '3' | 'manual';
  manualGrowth: number | null; // percent
  targetPeg: number | null;
}
export const emptyMultipleSettings = (): MultipleSettings => ({
  manualEps: null,
  peMethod: 'industry',
  overrides: {},
  growthMethod: '5',
  manualGrowth: null,
  targetPeg: 1,
});
export function resetPeSettings(s: MultipleSettings): MultipleSettings {
  return {
    ...emptyMultipleSettings(),
    growthMethod: s.growthMethod,
    manualGrowth: s.manualGrowth,
    targetPeg: s.targetPeg,
  };
}
export function resetPegSettings(s: MultipleSettings): MultipleSettings {
  return {
    ...s,
    growthMethod: '5',
    manualGrowth: null,
    targetPeg: 1,
    epsBasis: undefined,
    manualEps: null,
  };
}
export function resolveMultiples(
  data: MultipleInputs | null,
  s: MultipleSettings,
  peData: IndustryPeData,
  costs: IndustryWaccData,
) {
  const usable = (v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0;
  const defaultBasis = usable(data?.ttm.value)
    ? 'ttm'
    : usable(data?.annual[0]?.eps.value)
      ? 'annual'
      : 'ttm';
  const epsBasis = s.epsBasis ?? defaultBasis;
  const reference = epsBasis === 'annual' ? data?.annual[0]?.eps : data?.ttm;
  const eps =
    epsBasis === 'manual'
      ? s.manualEps
      : s.epsBasis === undefined && !usable(reference?.value)
        ? null
        : (reference?.value ?? null);
  const epsSelectionReason =
    s.epsBasis !== undefined
      ? `用户选择${epsBasis === 'annual' ? `完整财年FY${data?.annual[0]?.year ?? '—'}` : epsBasis === 'ttm' ? '最新TTM' : '手动EPS'}；不自动切换。`
      : usable(data?.ttm.value)
        ? '默认采用有效的最新TTM Diluted EPS。'
        : usable(data?.annual[0]?.eps.value)
          ? `TTM EPS缺失或非正，默认采用最新完整财年FY${data?.annual[0]?.year ?? '—'}。`
          : 'TTM及最新完整财年EPS均缺失或非正，可手动输入。';
  const match = multipleIndustry(data?.sic ?? null, s.industry);
  const industryPe =
    peData.industries.find((x) => x.name === match.name)?.pe ?? null;
  const industryKe =
    costs.industries.find((x) => x.name === match.name)?.costOfEquity ?? null;
  const roe = historicalRoe(data?.annual ?? []);
  const use = (
    key: keyof MultipleSettings['overrides'],
    fallback: number | null,
  ) => (s.overrides[key] !== undefined ? s.overrides[key]! : fallback);
  const inputs = {
    roe: use('roe', roe.value === null ? null : roe.value * 100),
    g: use('g', 2),
    ke: use('ke', industryKe === null ? null : industryKe * 100),
  };
  const justified = justifiedPe(
    inputs.roe === null ? null : inputs.roe / 100,
    inputs.g === null ? null : inputs.g / 100,
    inputs.ke === null ? null : inputs.ke / 100,
  );
  const pe =
    s.peMethod === 'justified'
      ? justified.value
      : use('pe', s.peMethod === 'industry' ? industryPe : null);
  const growth5 = epsGrowth(data?.annual ?? [], 5),
    growth3 = epsGrowth(data?.annual ?? [], 3);
  const growth =
    s.growthMethod === 'manual'
      ? s.manualGrowth === null
        ? null
        : s.manualGrowth / 100
      : s.growthMethod === '5'
        ? growth5.value
        : growth3.value;
  const peg = pegPe(growth, s.targetPeg);
  return {
    eps,
    epsBasis,
    epsSelectionReason,
    reference,
    match,
    industryPe,
    industryKe,
    roe,
    inputs,
    justified,
    pe,
    peValue: peValue(eps, pe),
    growth5,
    growth3,
    growth,
    peg,
    pegValue: peValue(eps, peg.value),
  };
}
