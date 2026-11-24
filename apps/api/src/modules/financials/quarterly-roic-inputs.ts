import {
  QUARTERLY_ROIC_INPUT_VERSION,
  type QuarterlyRoicInputs,
  type BalanceSheetInput,
} from '@company-research/shared';
import { reportedRoicIncome, type IncomeKey } from './annual-roic-inputs';
import { isObject } from './annual-financials';
const keys: IncomeKey[] = [
  'operatingIncome',
  'incomeTaxExpense',
  'pretaxIncome',
];
const shift = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const missing = (reason: string): BalanceSheetInput => ({
  value: null,
  status: 'REVIEW_REQUIRED',
  method: 'unverified',
  reason,
  items: [],
});
const complete = (e: ReturnType<typeof reportedRoicIncome>) =>
  keys.every((k) => e[k].status === 'VERIFIED');
/** Uses the existing normalizer's actual quarter boundaries and fiscal-year start.
 * All three flows use a coherent direct filing, or coherent cumulative bundles.
 * Never subtract EPS or infer an unreported quarter boundary. */
export function quarterlyRoicInputs(
  raw: unknown,
  period: {
    fiscalYear: number | null;
    fiscalQuarter: number;
    periodStart: string;
    periodEnd: string;
  },
  fiscalYearStart: string,
  sic: string | null,
): QuarterlyRoicInputs {
  const direct = reportedRoicIncome(raw, period, sic, true);
  const result: QuarterlyRoicInputs = {
    ...direct,
    version: QUARTERLY_ROIC_INPUT_VERSION,
    fiscalQuarter: period.fiscalQuarter,
    fiscalYearStart,
  };
  if (complete(direct)) return result;
  if (period.fiscalQuarter === 1) return result;
  const current = reportedRoicIncome(
    raw,
    { ...period, periodStart: fiscalYearStart },
    sic,
    true,
  );
  const prior = reportedRoicIncome(
    raw,
    {
      ...period,
      periodStart: fiscalYearStart,
      periodEnd: shift(period.periodStart, -1),
    },
    sic,
    true,
    current.operatingIncome.items[0]?.filed as string | undefined,
  );
  const canDerive =
    complete(current) &&
    complete(prior) &&
    keys.every((k) => {
      const c = current[k].items[0],
        p = prior[k].items[0];
      return (
        String(p.filed) <= String(c.filed) &&
        c.concept === p.concept &&
        c.unit === p.unit
      );
    });
  // A reported partial direct quarter must reconcile before using a derived bundle.
  const compatible =
    canDerive &&
    keys.every(
      (k) =>
        direct[k].value === null ||
        direct[k].value === current[k].value! - prior[k].value!,
    );
  if (!canDerive) {
    // Keep any known directly reported components; never fill the others from YTD.
    for (const k of keys)
      if (result[k].value === null)
        result[k] = missing(
          '缺少可勾稽的单季度损益或同口径累计损益；不直接使用YTD、不补零',
        );
    return result;
  }
  for (const k of keys) {
    const v = current[k].value! - prior[k].value!;
    result[k] =
      compatible && Number.isFinite(v)
        ? {
            value: v,
            status: 'VERIFIED',
            reason: null,
            method: 'roic_cumulative_difference_v1',
            items: [...current[k].items, ...prior[k].items],
          }
        : missing(
            '缺少可勾稽的单季度损益或同口径累计损益；不直接使用YTD、不补零',
          );
  }
  result.taxDisclosures = [];
  return result;
}
/** Validate persisted derivation provenance again on API reads. */
export function validQuarterIncome(
  v: BalanceSheetInput,
  e: QuarterlyRoicInputs,
  asOf: string,
): boolean {
  if (
    !v ||
    v.status !== 'VERIFIED' ||
    v.value === null ||
    !Number.isFinite(v.value) ||
    !Array.isArray(v.items)
  )
    return false;
  const xs = v.items;
  const basic = xs.every(
    (x) =>
      isObject(x) &&
      x.unit === 'USD' &&
      typeof x.val === 'number' &&
      Number.isFinite(x.val) &&
      /^10-[KQ](\/A)?$/.test(String(x.form)) &&
      /^\d{10}-\d{2}-\d{6}$/.test(String(x.accn)) &&
      typeof x.filed === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(x.filed) &&
      Number.isFinite(Date.parse(x.filed)) &&
      new Date(x.filed).toISOString().slice(0, 10) === x.filed &&
      x.filed >= String(x.end) &&
      x.filed <= asOf,
  );
  if (!basic) return false;
  if (v.method !== 'roic_cumulative_difference_v1')
    return (
      xs.length === 1 &&
      xs[0].start === e.periodStart &&
      xs[0].end === e.periodEnd &&
      xs[0].val === v.value
    );
  if (xs.length !== 2 || e.fiscalQuarter === 1) return false;
  const [c, p] = xs;
  return (
    c.start === e.fiscalYearStart &&
    p.start === e.fiscalYearStart &&
    c.end === e.periodEnd &&
    p.end === shift(e.periodStart, -1) &&
    p.filed! <= c.filed! &&
    c.concept === p.concept &&
    typeof c.val === 'number' &&
    typeof p.val === 'number' &&
    c.val - p.val === v.value
  );
}

export function validQuarterPeriod(e: QuarterlyRoicInputs): boolean {
  if (
    typeof e.fiscalYearStart !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.fiscalYearStart) ||
    !Number.isFinite(Date.parse(e.fiscalYearStart)) ||
    new Date(e.fiscalYearStart).toISOString().slice(0, 10) !==
      e.fiscalYearStart ||
    e.fiscalYearStart > e.periodStart ||
    (e.fiscalQuarter === 1 && e.periodStart !== e.fiscalYearStart)
  )
    return false;
  const elapsed =
    (Date.parse(e.periodEnd) - Date.parse(e.fiscalYearStart)) / 86400000 + 1;
  return Math.abs(elapsed - e.fiscalQuarter * 91) <= 20;
}
