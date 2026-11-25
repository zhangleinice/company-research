import {
  approximateSimpleFcff,
  SIMPLE_DEFAULT_POLICY,
  defaultTaxRate,
  defaultTerminalGrowth,
  historicalGrowth,
  industryWacc,
  type FcffMethod,
  type TaxMethod,
  type GrowthMethod,
  type SimpleValuationData,
  type IndustryWaccData,
  type ValuationBaseline,
  type SimpleEstimate,
} from '@company-research/shared';
export interface SimpleSettings {
  basis: FcffMethod;
  taxMethod?: TaxMethod;
  taxManual: number | null;
  growthMethod: GrowthMethod;
  industry?: string | null;
  overrides: Partial<
    Record<'growth' | 'wacc' | 'terminalGrowth', number | null>
  >;
  manualFcff: number | null;
  manualReason: string;
}
export const emptySimpleSettings = (): SimpleSettings => ({
  basis: 'ttm',
  taxManual: null,
  growthMethod: 'fcf',
  overrides: {},
  manualFcff: null,
  manualReason: '',
});
export function resolveSimpleSettings(
  data: SimpleValuationData | null,
  s: SimpleSettings,
  industries: IndustryWaccData,
) {
  const taxMethod =
    s.taxMethod ?? (data?.usIncorporated === true ? 'federal' : 'effective');
  const tax = defaultTaxRate(data, taxMethod, s.taxManual);
  const period =
    s.basis === 'annual' ? (data?.latestAnnual ?? null) : (data?.ttm ?? null);
  const automaticFcff = approximateSimpleFcff(period, tax.value);
  const fcff: SimpleEstimate =
    s.basis === 'manual'
      ? {
          value:
            s.manualFcff !== null &&
            Number.isFinite(s.manualFcff) &&
            s.manualFcff > 0 &&
            s.manualReason.trim()
              ? s.manualFcff
              : null,
          reason: s.manualReason.trim()
            ? '手动正常化FCFF研究假设'
            : '请填写正FCFF及调整依据',
          formula: `手动FCFF = ${s.manualFcff ?? '—'}（百万美元）`,
          warnings: [
            '用户研究估计，不是已核准SEC事实；不能自动用Owner Earnings替代FCFF。',
          ],
        }
      : automaticFcff;
  const growth = historicalGrowth(data?.annual ?? [], s.growthMethod, 5),
    growth3 = historicalGrowth(data?.annual ?? [], s.growthMethod, 3);
  const wacc = industryWacc(industries, data?.sic ?? null, s.industry);
  const terminal = defaultTerminalGrowth(data?.currency ?? null);
  const use = (key: keyof SimpleSettings['overrides'], v: number | null) =>
    s.overrides[key] !== undefined
      ? s.overrides[key]!
      : v === null
        ? null
        : v * 100;
  return {
    taxMethod,
    tax,
    period,
    fcff,
    growth,
    growth3,
    wacc,
    terminal,
    parameters: {
      growth: use('growth', growth.value),
      wacc: use('wacc', wacc.value),
      terminalGrowth: use('terminalGrowth', terminal.value),
    },
  };
}
export function simpleCalculationBaseline(
  baseline: ValuationBaseline,
  settings: SimpleSettings,
  resolved: ReturnType<typeof resolveSimpleSettings>,
): ValuationBaseline {
  return {
    ...baseline,
    fcff: null,
    fcffEstimate: {
      status: resolved.fcff.value === null ? 'MISSING' : 'RESEARCH',
      value: resolved.fcff.value === null ? null : resolved.fcff.value * 1e6,
      taxRate: resolved.tax.value,
      version: SIMPLE_DEFAULT_POLICY,
      reason: `${settings.basis === 'annual' ? (resolved.period?.label ?? '完整财年') : settings.basis === 'manual' ? '手动' : 'TTM'}；${resolved.fcff.formula}；${resolved.fcff.reason ?? '条件性近似基准'}`,
      assumptions: resolved.fcff.warnings,
    },
  };
}
export function setSimpleOverride(
  s: SimpleSettings,
  key: keyof SimpleSettings['overrides'],
  value: number | null,
) {
  return { ...s, overrides: { ...s.overrides, [key]: value } };
}
export function resetSimpleOverride(
  s: SimpleSettings,
  key: keyof SimpleSettings['overrides'],
) {
  const overrides = { ...s.overrides };
  delete overrides[key];
  return { ...s, overrides };
}
