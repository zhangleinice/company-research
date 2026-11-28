import {
  approximateSimpleFcff,
  estimateEbitFcff,
  fcffBridgeNotice,
  type EbitOverrides,
  type EbitComponent,
  type FcffCalculationMethod,
  SIMPLE_DEFAULT_POLICY,
  EBIT_FCFF_POLICY,
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
  /** Undefined uses availability-based defaults; an explicit choice stays selected. */
  calculationMethod?: FcffCalculationMethod;
  ebitOverrides?: Partial<Record<'annual' | 'ttm', EbitOverrides>>;
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
  ebitOverrides: {},
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
  const ebit = estimateEbitFcff(
    period,
    tax.value,
    s.ebitOverrides?.[s.basis === 'annual' ? 'annual' : 'ttm'] ?? {},
  );
  const ocf = approximateSimpleFcff(period, tax.value);
  const usable = (x: SimpleEstimate) =>
    x.value !== null && Number.isFinite(x.value) && x.value > 0;
  const defaultMethod = usable(ebit) ? 'ebit' : usable(ocf) ? 'ocf' : 'ebit';
  const defaultMethodReason = usable(ebit)
    ? `EBIT法具备有效计算条件，优先采用${ebit.nwcBasis === 'PARTIAL' ? '；ΔNWC为部分估计，存在遗漏风险' : ''}。`
    : usable(ocf)
      ? `EBIT法暂不可用于估值：${ebit.reason ?? '无有效正FCFF'}；OCF法可用，默认采用OCF法。`
      : '两种方法均暂无有效正FCFF基准，保留缺失或不可估值状态，可手动填写研究假设。';
  const calculationMethod = s.calculationMethod ?? defaultMethod;
  const automaticFcff = calculationMethod === 'ebit' ? ebit : ocf;
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
    calculationMethod,
    methodSelectionReason:
      s.calculationMethod === undefined
        ? defaultMethodReason
        : '当前为用户主动选择，输入或期间变化不会自动切换方法；恢复默认后重新按可用性选择。',
    ebit,
    bridgeNotice: fcffBridgeNotice(
      calculationMethod,
      s.basis === 'manual',
      ebit.nwcBasis === 'PARTIAL',
    ),
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
      version:
        settings.basis !== 'manual' && resolved.calculationMethod === 'ebit'
          ? EBIT_FCFF_POLICY
          : SIMPLE_DEFAULT_POLICY,
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

export function setEbitOverride(
  s: SimpleSettings,
  key: EbitComponent,
  value: number | null,
): SimpleSettings {
  const basis = s.basis === 'annual' ? 'annual' : 'ttm';
  return {
    ...s,
    ebitOverrides: {
      ...s.ebitOverrides,
      [basis]: { ...s.ebitOverrides?.[basis], [key]: value },
    },
  };
}
export function resetEbitOverride(
  s: SimpleSettings,
  key: EbitComponent,
): SimpleSettings {
  const basis = s.basis === 'annual' ? 'annual' : 'ttm',
    fields = { ...s.ebitOverrides?.[basis] };
  delete fields[key];
  return { ...s, ebitOverrides: { ...s.ebitOverrides, [basis]: fields } };
}
