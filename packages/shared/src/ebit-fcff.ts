import type { SimpleFcffPeriod, SimpleEstimate } from './simple-valuation.js';
import { OPERATING_NWC_POLICY } from './operating-working-capital.js';
import type { ValuationFact } from './dcf.js';
export const EBIT_FCFF_POLICY = 'ebit-fcff-v1';
export type FcffCalculationMethod = 'ebit' | 'ocf';
export type EbitComponent = 'ebit' | 'da' | 'capex' | 'deltaNwc';
/** UI research amounts in USD millions, never changes SEC inputs. An explicit null clears a field. */
export type EbitOverrides = Partial<Record<EbitComponent, number | null>>;
export interface EbitFcffEstimate extends SimpleEstimate {
  defaults: Record<EbitComponent, number | null>;
  components: Record<EbitComponent, number | null> & { nopat: number | null };
  nwcBasis: 'COMPLETE' | 'APPROXIMATE' | 'PARTIAL' | 'MANUAL' | 'MISSING';
  manualComponents: EbitComponent[];
}
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);
const sourceValid = (f: ValuationFact | undefined, p: SimpleFcffPeriod) =>
  Boolean(
    f &&
    finite(f.value) &&
    f.start === p.start &&
    f.end === p.end &&
    Array.isArray(f.items) &&
    f.items.length &&
    f.items.every((x) => x.unit === 'USD'),
  );
/** One FCFF formula shared by UI/research preview; no interest add-back, no OCF fallback. */
export function estimateEbitFcff(
  p: SimpleFcffPeriod | null,
  tax: number | null,
  overrides: EbitOverrides = {},
): EbitFcffEstimate {
  const input = p?.ebitInputs;
  const defaults: Record<EbitComponent, number | null> = {
    ebit: null,
    da: null,
    capex: null,
    deltaNwc: null,
  };
  const warnings = [
    '采用Operating Income计算NOPAT，不再加回融资利息，也不再次扣减已排除的非经营性投资收益。',
    '现金PP&E CapEx未覆盖全部融资租赁新增资产及其他经济再投资；经营租赁仍按经营成本处理。',
    '特殊索偿的历史费用、未来付款与股权桥接仍须避免重复计量；必要经营现金增量已包含于所选ΔNWC，不再额外扣除。',
    'EBIT已包含SBC费用，本公式不再加回或再次扣减SBC；现有股数仍未完成全部潜在稀释调整。',
  ];
  let nwcBasis: EbitFcffEstimate['nwcBasis'] = 'MISSING';
  const issues: string[] = [];
  if (!input)
    warnings.push(
      '旧缓存或旧API尚未包含EBIT法组成输入，不自动切换到OCF法；可以手动填写研究假设。',
    );
  if (p) {
    const e = input?.operatingIncome,
      d = input?.depreciationAmortization,
      n = input?.workingCapital;
    if (sourceValid(e, p) && e?.concept === 'us-gaap:OperatingIncomeLoss')
      defaults.ebit = e.value! / 1e6;
    if (
      sourceValid(d, p) &&
      (d?.policyVersion === 'depreciation-amortization-v1' ||
        [
          'us-gaap:DepreciationDepletionAndAmortization',
          'us-gaap:DepreciationAndAmortization',
        ].includes(d?.concept ?? '')) &&
      d!.value! >= 0
    )
      defaults.da = d!.value! / 1e6;
    if (
      sourceValid(p.capex, p) &&
      p.capex.concept ===
        'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment' &&
      p.capex.value! >= 0
    )
      defaults.capex = p.capex.value! / 1e6;
    if (
      n?.policyVersion === OPERATING_NWC_POLICY &&
      n.cik === input?.cik &&
      n.unit === 'USD' &&
      n.periodStart === p.start &&
      n.periodEnd === p.end &&
      Array.isArray(n.items) &&
      Array.isArray(n.warnings) &&
      n.items.some((x) => x.status === 'INCLUDED' && finite(x.cashImpact)) &&
      !n.items.some((x) => x.status === 'CONFLICT') &&
      finite(n.identifiedCashImpact) &&
      finite(n.operatingCash?.increment)
    ) {
      if (n.status === 'COMPLETE' && finite(n.completeValue)) {
        defaults.deltaNwc = n.completeValue / 1e6;
        nwcBasis = 'COMPLETE';
      } else if (n.status === 'APPROXIMATE' && finite(n.approximateValue)) {
        defaults.deltaNwc = n.approximateValue / 1e6;
        nwcBasis = 'APPROXIMATE';
      } else if (n.status === 'PARTIAL' && finite(n.partialValue)) {
        defaults.deltaNwc = n.partialValue / 1e6;
        nwcBasis = 'PARTIAL';
      }
      warnings.push(...n.warnings);
      if (nwcBasis === 'PARTIAL')
        warnings.push(
          '使用已有财报依据的部分ΔNWC作初步研究估值，不是完整核准营运资金投入。',
        );
      for (const item of n.items.filter((x) =>
        ['MISSING', 'UNRESOLVED', 'CONFLICT'].includes(x.status),
      ))
        warnings.push(
          `ΔNWC未纳入：${item.label}；${item.cashImpact === null ? '完整期间金额缺失' : `${item.cashImpact / 1e6}百万美元现金影响`}；${item.reason}`,
        );
    }
    if (d?.approximate)
      warnings.push(d.reason ?? 'D&A采用附注舍入金额近似汇总。');
    warnings.push(...(input?.cacheIssues ?? []), ...(input?.limitations ?? []));
  }
  const manualComponents = (Object.keys(defaults) as EbitComponent[]).filter(
    (k) => Object.prototype.hasOwnProperty.call(overrides, k),
  );
  const values = { ...defaults, ...overrides };
  if (manualComponents.includes('deltaNwc')) {
    nwcBasis = 'MANUAL';
    warnings.push('ΔNWC使用用户估计；应包含必要经营现金增量，不能再重复扣除。');
  }
  if (manualComponents.length)
    warnings.push(
      `手动研究假设：${manualComponents.join('、')}；未修改SEC原始数据。`,
    );
  if (
    !p ||
    !p.start ||
    !Number.isFinite(Date.parse(p.start)) ||
    !Number.isFinite(Date.parse(p.end)) ||
    (Date.parse(p.end) - Date.parse(p.start)) / 86400000 < 350 ||
    (Date.parse(p.end) - Date.parse(p.start)) / 86400000 > 380
  )
    issues.push('缺少完整年度或TTM期间');
  if (input?.applicable === false)
    issues.push('金融企业等不适用普通经营企业FCFF模型');
  if (!finite(tax) || tax < 0 || tax > 1)
    issues.push('缺少0%至100%的有效研究税率');
  const labels = {
    ebit: 'Operating Income',
    da: '完整D&A',
    capex: '现金CapEx',
    deltaNwc: 'ΔNWC',
  };
  for (const key of Object.keys(defaults) as EbitComponent[]) {
    if (!finite(values[key]))
      issues.push(
        `${labels[key]}缺失或无效${!manualComponents.includes(key) ? '，可手动输入研究假设' : ''}`,
      );
    else if ((key === 'da' || key === 'capex') && values[key]! < 0)
      issues.push(`${labels[key]}不得为负`);
  }
  const nopat =
    finite(values.ebit) && finite(tax) && tax >= 0 && tax <= 1
      ? values.ebit * (1 - tax)
      : null;
  const value =
    issues.length || nopat === null
      ? null
      : nopat + values.da! - values.capex! - values.deltaNwc!;
  const actual = finite(value) ? value : null;
  const fmt = (x: number | null) => (x === null ? '—' : String(x));
  return {
    value: actual,
    defaults,
    components: { ...values, nopat },
    nwcBasis,
    manualComponents,
    reason: issues.length
      ? issues.join('；')
      : actual === null
        ? 'FCFF计算超出有效范围'
        : actual <= 0
          ? 'FCFF非正，保留计算值；现有简单增长模型不能据此估值'
          : null,
    formula: `FCFF = ${fmt(values.ebit)} × (1 − ${tax === null ? '—' : tax}) + ${fmt(values.da)} − ${fmt(values.capex)} − (${fmt(values.deltaNwc)}) = ${fmt(actual)}（百万美元）`,
    warnings: [...new Set(warnings)],
  };
}
export function fcffBridgeNotice(
  method: FcffCalculationMethod,
  manual: boolean,
  partial: boolean,
): string {
  if (manual)
    return '手动FCFF的非经营收益、索偿、租赁及SBC范围尚需独立判断，股权桥接结果仅作条件性研究参考。';
  if (method === 'ocf')
    return '当前FCFF尚未完成非经营性收益调整，估值可能存在重复计价，仅作为初步研究参考。';
  return `EBIT法不额外加回融资利息；${partial ? 'ΔNWC采用部分估计，存在遗漏风险；' : ''}非经营资产归属、特殊索偿、租赁及SBC/稀释仍需一致处理，仅作初步研究参考。`;
}
