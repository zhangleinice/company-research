import {
  MULTIPLES_POLICY,
  type MultipleInputs,
  type EpsReference,
  type MultipleYear,
} from '@company-research/shared';
import { isObject } from '../financials/annual-financials';
interface Row {
  periodStart: Date;
  periodEnd: Date;
  fiscalYear: number | null;
  currency: string | null;
  eps: unknown;
  roe: unknown;
  epsCagr3y: unknown;
  epsCagr5y: unknown;
  sources: unknown;
}
const number = (v: unknown) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? null
    : Number(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const days = (s: string, e: string) =>
  (Date.parse(e) - Date.parse(s)) / 86400000 + 1;
function reported(r: Row, quarterly = false): EpsReference {
  const start = iso(r.periodStart),
    end = iso(r.periodEnd),
    value = number(r.eps);
  const source =
    isObject(r.sources) && isObject(r.sources.eps) ? r.sources.eps : null;
  const items =
    source && Array.isArray(source.items) ? source.items.filter(isObject) : [];
  const valid =
    r.currency === 'USD' &&
    end <= new Date().toISOString().slice(0, 10) &&
    source?.method === 'reported' &&
    items.length === 1 &&
    items.every(
      (x) =>
        x.concept === 'us-gaap:EarningsPerShareDiluted' &&
        x.unit === 'USD/shares' &&
        x.start === start &&
        x.end === end &&
        x.val === value &&
        typeof x.filed === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(x.filed) &&
        x.filed <= new Date().toISOString().slice(0, 10) &&
        typeof x.accn === 'string' &&
        /^\d{10}-\d{2}-\d{6}$/.test(x.accn) &&
        /^10-[KQ](\/A)?$/.test(String(x.form)),
    ) &&
    (quarterly
      ? days(start, end) >= 70 && days(start, end) <= 110
      : days(start, end) >= 350 && days(start, end) <= 380);
  return {
    value: valid ? value : null,
    start,
    end,
    sources: valid ? items : [],
    reason: valid
      ? null
      : '缺少经核准的同期间直接披露稀释EPS；不从累计EPS差分推导',
  };
}
export function multipleInputs(
  cik: string,
  sic: string | null,
  annual: Row[],
  quarterly: Row[],
  asOf: string,
): MultipleInputs {
  const today = new Date().toISOString().slice(0, 10);
  const rows = annual
    .filter(
      (r) =>
        iso(r.periodEnd) <= today &&
        days(iso(r.periodStart), iso(r.periodEnd)) >= 350 &&
        days(iso(r.periodStart), iso(r.periodEnd)) <= 380,
    )
    .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())
    .slice(0, 10);
  const years: MultipleYear[] = rows.map((r) => {
    const src = isObject(r.sources) ? r.sources : {};
    const roeSource =
      isObject(src.roe) && Array.isArray(src.roe.inputs)
        ? src.roe.inputs.filter(isObject)
        : [];
    return {
      year: r.fiscalYear,
      start: iso(r.periodStart),
      end: iso(r.periodEnd),
      eps: reported(r),
      roe:
        roeSource.length && number(r.roe) !== null
          ? number(r.roe)! / 100
          : null,
      roeSources: roeSource,
      comparableCagr: {
        3: number(r.epsCagr3y) === null ? null : number(r.epsCagr3y)! / 100,
        5: number(r.epsCagr5y) === null ? null : number(r.epsCagr5y)! / 100,
      },
    };
  });
  let ttm: EpsReference = {
    value: null,
    start: null,
    end: asOf,
    sources: [],
    reason:
      '缺少四个连续、可比的直接披露独立季度EPS；不使用年度减累计EPS填补Q4，也不回退旧期间',
  };
  const exact = years.find((r) => r.end === asOf);
  if (exact) ttm = { ...exact.eps };
  else {
    const qs = quarterly
        .filter((r) => iso(r.periodEnd) <= asOf)
        .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())
        .slice(0, 4),
      refs = qs.map((r) => reported(r, true));
    const valid =
      refs.length === 4 &&
      refs[0].end === asOf &&
      days(refs[3].start!, asOf) >= 350 &&
      days(refs[3].start!, asOf) <= 380 &&
      refs.every(
        (x, i) =>
          x.value !== null &&
          (i === 0 ||
            Date.parse(refs[i - 1].start!) - Date.parse(x.end) === 86400000),
      );
    // Different share bases after a split cannot be certified from independent cached quarters alone.
    const sameFiling =
      valid &&
      new Set(refs.flatMap((x) => x.sources.map((s) => s.accn))).size === 1;
    if (sameFiling)
      ttm = {
        value: refs.reduce((s, x) => s + x.value!, 0),
        start: refs[3].start,
        end: asOf,
        sources: refs.flatMap((x) => x.sources),
        reason: '四个同申报可比季度EPS之和；各季稀释分母可能变化，属于滚动参考',
      };
  }
  return {
    version: 1,
    policy: MULTIPLES_POLICY,
    cik,
    sic,
    ttm,
    annual: years,
    warnings: [
      '仅使用缓存中的直接披露稀释EPS及已核准历史比较；不以净利润除最新股数冒充稀释EPS。',
      '股票拆分及重述依赖已有SEC归一化可比性验证；旧缓存不足时保持缺失。',
    ],
  };
}
