import type { ValuationFact } from '@company-research/shared';
export const validFinancialDate = (d: unknown): d is string =>
  typeof d === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
export const shiftFinancialDate = (d: string, days: number) =>
  new Date(Date.parse(d) + days * 86400000).toISOString().slice(0, 10);
/** Existing D&A/OCF source-chain arithmetic, shared with NWC; no fy/fp relabeling. */
export function cashFlowPeriod(ocf: ValuationFact): {
  weights: number[];
  reason: string | null;
} {
  const fail = (reason: string) => ({ weights: [], reason });
  if (
    !validFinancialDate(ocf.start) ||
    !validFinancialDate(ocf.end) ||
    ocf.value === null ||
    !Number.isFinite(ocf.value)
  )
    return fail('OCF期间或金额缺失');
  const days = (Date.parse(ocf.end) - Date.parse(ocf.start)) / 86400000;
  if (days < 60 || days > 380) return fail('不是完整季度、财年或TTM期间');
  const xs = ocf.items;
  if (
    !xs.length ||
    xs.some(
      (x) =>
        x.concept !== 'us-gaap:NetCashProvidedByUsedInOperatingActivities' ||
        x.unit !== 'USD' ||
        !validFinancialDate(x.start) ||
        !validFinancialDate(x.end) ||
        !validFinancialDate(x.filed) ||
        String(x.filed) < String(x.end) ||
        typeof x.accn !== 'string' ||
        !/^\d{10}-\d{2}-\d{6}$/.test(x.accn) ||
        !/^10-[KQ](\/A)?$/.test(String(x.form)) ||
        typeof x.val !== 'number' ||
        !Number.isFinite(x.val),
    )
  )
    return fail('OCF原始期间或申报来源不完整');
  let weights: number[];
  if (xs.length === 1 && xs[0].start === ocf.start && xs[0].end === ocf.end)
    weights = [1];
  else if (
    xs.length === 2 &&
    xs[0].start === xs[1].start &&
    xs[0].end === ocf.end &&
    shiftFinancialDate(String(xs[1].end), 1) === ocf.start
  )
    weights = [1, -1];
  else if (
    xs.length === 3 &&
    xs[0].start === xs[2].start &&
    shiftFinancialDate(String(xs[0].end), 1) === xs[1].start &&
    xs[1].end === ocf.end &&
    shiftFinancialDate(String(xs[2].end), 1) === ocf.start
  )
    weights = [1, 1, -1];
  else return fail('不支持或不连续的年度、独立季度或TTM来源链');
  if (
    Math.abs(
      xs.reduce((n, x, i) => n + Number(x.val) * weights[i], 0) - ocf.value,
    ) > 0.01
  )
    return fail('OCF来源与期间算术不一致');
  return { weights, reason: null };
}
