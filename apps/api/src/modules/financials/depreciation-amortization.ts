import { cashFlowPeriod, validFinancialDate as date } from './cash-flow-period';
import type {
  OwnerEarningsFact,
  OwnerEarningsSource,
  ValuationFact,
} from '@company-research/shared';
import { isObject } from './annual-financials';

export const DA_POLICY = 'depreciation-amortization-v1';
export interface DepreciationDisclosure extends OwnerEarningsSource {
  cik: string;
  kind: 'total' | 'depreciation' | 'amortization';
  decimals?: number | 'INF';
  evidence?: string;
}
const TOTALS = [
  'DepreciationDepletionAndAmortization',
  'DepreciationAndAmortization',
];
const KINDS = {
  Depreciation: 'depreciation',
  AmortizationOfIntangibleAssets: 'amortization',
} as const;
/** Full D&A only: the broad PP&E depreciation and intangible amortization concepts
 * are disjoint asset classes. Lease amortization, accretion, impairments and Other
 * are never substituted for either class. Every leg follows the existing OCF period. */
export function depreciationAmortization(
  raw: unknown,
  cik: string,
  ocf: ValuationFact,
  supplemental: readonly DepreciationDisclosure[] = [],
): ValuationFact {
  const missing = (reason: string): ValuationFact => ({
    value: null,
    start: ocf.start,
    end: ocf.end,
    concept: null,
    items: [],
    reason,
    policyVersion: DA_POLICY,
  });
  if (
    !isObject(raw) ||
    String(raw.cik).padStart(10, '0') !== cik ||
    !isObject(raw.facts) ||
    !isObject(raw.facts['us-gaap']) ||
    ocf.value === null ||
    !Number.isFinite(ocf.value) ||
    !date(ocf.start) ||
    !date(ocf.end)
  )
    return missing('缺少同公司、同期间OCF来源，无法核准D&A范围');
  const chain = cashFlowPeriod(ocf);
  if (chain.reason) return missing(chain.reason);
  const { weights } = chain;
  const taxonomy = raw.facts['us-gaap'];
  const legs = ocf.items;
  const results: Array<{
    value: number;
    sources: OwnerEarningsSource[];
    approximate: boolean;
    method: string;
  }> = [];
  for (const leg of legs) {
    const same = (f: Record<string, unknown>) =>
      f.start === leg.start &&
      f.end === leg.end &&
      f.accn === leg.accn &&
      f.filed === leg.filed &&
      f.form === leg.form &&
      !f.segment &&
      !f.dimensions;
    let conflict = false;
    const read = (tag: string, kind: DepreciationDisclosure['kind']) => {
      const concept = taxonomy[tag];
      const xs =
        isObject(concept) &&
        isObject(concept.units) &&
        Array.isArray(concept.units.USD)
          ? concept.units.USD.filter(isObject)
              .filter(same)
              .map((f) => ({
                ...f,
                concept: `us-gaap:${tag}`,
                unit: 'USD',
                url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(f.accn).replaceAll('-', '')}/${f.accn}-index.html`,
              }))
          : [];
      const extra = supplemental.filter(
        (f) =>
          f.cik === cik &&
          f.kind === kind &&
          f.concept === `us-gaap:${tag}` &&
          same({ ...f }) &&
          f.unit === 'USD',
      );
      const all: Record<string, unknown>[] = [
        ...xs,
        ...extra.map((f) => ({ ...f })),
      ];
      if (!all.length) return null;
      if (
        all.some(
          (f) =>
            typeof f.val !== 'number' ||
            !Number.isFinite(f.val) ||
            f.val < 0 ||
            f.val !== all[0].val,
        )
      ) {
        conflict = true;
        return null;
      }
      return (extra[0] ?? all[0]) as unknown as OwnerEarningsSource;
    };
    const totals = TOTALS.map((tag) => read(tag, 'total')).filter(
      (x): x is OwnerEarningsSource => x !== null,
    );
    const custom = supplemental.filter(
      (f) =>
        f.cik === cik &&
        f.kind === 'total' &&
        !f.concept.startsWith('us-gaap:') &&
        same({ ...f }) &&
        f.unit === 'USD',
    );
    totals.push(...custom);
    if (
      conflict ||
      totals.some(
        (f) => !Number.isFinite(f.val) || f.val < 0 || f.val !== totals[0].val,
      )
    )
      return missing('同申报D&A合计披露存在冲突，不能降级采用分项');
    if (totals.length) {
      const f = totals[0];
      results.push({
        value: f.val,
        sources: [f],
        approximate: f.approximate === true,
        method: 'reported_complete_total',
      });
      continue;
    }
    const components = Object.entries(KINDS).map(([tag, kind]) =>
      read(tag, kind),
    );
    if (conflict) return missing('同申报折旧或摊销分项金额存在冲突');
    if (components.some((f) => !f))
      return missing(
        '缺少同申报、同期间完整折旧及无形资产摊销；不将折旧、租赁摊销或含Other合计当作完整D&A',
      );
    const sources = components as OwnerEarningsSource[];
    results.push({
      value: sources.reduce((n, f) => n + f.val, 0),
      sources,
      // CompanyFacts omits decimals; do not promise unrounded precision for a footnote sum.
      approximate: sources.some((f) => f.approximate !== false),
      method: 'disjoint_ppe_depreciation_plus_intangible_amortization',
    });
  }
  const value = results.reduce((n, r, i) => n + r.value * weights[i], 0);
  if (!Number.isFinite(value) || value < 0)
    return missing('期间推导得到负D&A或无效金额，范围可能不一致');
  const approximate = results.some((r) => r.approximate);
  return {
    value,
    start: ocf.start,
    end: ocf.end,
    concept: results.every(
      (r) =>
        r.sources.length === 1 &&
        r.sources[0].concept === results[0].sources[0].concept,
    )
      ? results[0].sources[0].concept
      : 'calculated:CompleteDepreciationAndAmortization',
    policyVersion: DA_POLICY,
    approximate,
    reason: approximate
      ? '分项附注或原始披露按舍入精度近似汇总，保留披露精度'
      : null,
    calculation: results
      .map(
        (r, i) =>
          `${i ? (weights[i] > 0 ? ' + ' : ' − ') : ''}(${r.sources.map((s) => `${s.concept} ${s.val}`).join(' + ')})`,
      )
      .join(''),
    items: results.flatMap((r, i) =>
      r.sources.map((f) => ({
        ...f,
        coefficient: weights[i],
        method: r.method,
      })),
    ),
  };
}

export function ownerDepreciationFact(f: ValuationFact): OwnerEarningsFact {
  return {
    value: f.value,
    reason: f.reason ?? null,
    sources: f.items as unknown as OwnerEarningsSource[],
    approximate: f.approximate,
    calculation: f.calculation,
    policyVersion: DA_POLICY,
  };
}

/** Revalidate annual persisted JSON before exposing D&A through Owner Earnings.
 * The original single-fact SBC and ordinary financial metric validators stay strict. */
export function storedAnnualDepreciation(
  item: unknown,
  start: string,
  end: string,
  ocf: OwnerEarningsSource,
): OwnerEarningsFact | null {
  if (
    !isObject(item) ||
    item.policyVersion !== DA_POLICY ||
    typeof item.value !== 'number' ||
    !Number.isFinite(item.value) ||
    item.value < 0 ||
    !Array.isArray(item.sources)
  )
    return null;
  const sources = item.sources.filter(isObject);
  if (
    !sources.length ||
    sources.length !== item.sources.length ||
    sources.some(
      (s) =>
        s.start !== start ||
        s.end !== end ||
        s.accn !== ocf.accn ||
        s.filed !== ocf.filed ||
        !/^10-K(\/A)?$/.test(String(s.form)) ||
        s.unit !== 'USD' ||
        s.coefficient !== 1 ||
        typeof s.val !== 'number' ||
        !Number.isFinite(s.val) ||
        s.val < 0,
    )
  )
    return null;
  const complete =
    sources.length === 1 &&
    (TOTALS.some((t) => sources[0].concept === `us-gaap:${t}`) ||
      (sources[0].kind === 'total' &&
        typeof sources[0].evidence === 'string' &&
        /SHA256 [a-f0-9]{64}/.test(sources[0].evidence)));
  const pair =
    sources.length === 2 &&
    new Set(sources.map((s) => s.concept)).size === 2 &&
    Object.keys(KINDS).every((t) =>
      sources.some((s) => s.concept === `us-gaap:${t}`),
    );
  if (
    (!complete && !pair) ||
    Math.abs(sources.reduce((n, s) => n + Number(s.val), 0) - item.value) > 0.01
  )
    return null;
  return {
    value: item.value,
    reason: typeof item.reason === 'string' ? item.reason : null,
    sources: sources as unknown as OwnerEarningsSource[],
    approximate: item.approximate === true,
    calculation:
      typeof item.calculation === 'string' ? item.calculation : undefined,
    policyVersion: DA_POLICY,
  };
}
