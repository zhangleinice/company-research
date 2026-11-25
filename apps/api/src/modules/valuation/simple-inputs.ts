import {
  usIncorporation,
  type SimpleValuationData,
  type SimpleFcffPeriod,
  type ValuationBaseline,
  type ValuationFact,
} from '@company-research/shared';
import { ownerReportedFact } from '../financials/owner-earnings-inputs';
import { isObject } from '../financials/annual-financials';
import { historicalEffectiveTaxRate } from './enterprise-quality';
import { withResearchFcff } from './research-fcff';
export interface SimpleStoredRow {
  periodStart: Date;
  periodEnd: Date;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  currency: string | null;
  revenue: unknown;
  operatingCashFlow: unknown;
  capex: unknown;
  operatingIncome: unknown;
  sources: unknown;
  revenueCagr3y?: unknown;
  revenueCagr5y?: unknown;
  fcfCagr3y?: unknown;
  fcfCagr5y?: unknown;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const numeric = (v: unknown) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? null
    : Number(v);
const missing = (end: string): ValuationFact => ({
  value: null,
  start: null,
  end,
  concept: null,
  items: [],
});
export function simpleValuationInputs(
  cik: string,
  rawBaseline: ValuationBaseline | null,
  rows: SimpleStoredRow[],
  profile: { sic?: string | null; incorporation?: string | null } | null,
): SimpleValuationData {
  const b = rawBaseline?.cik === cik ? rawBaseline : null;
  const end = b?.asOf ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const annual = rows
    .filter(
      (r) =>
        r.fiscalQuarter === null &&
        r.currency === 'USD' &&
        iso(r.periodEnd) <= today &&
        (r.periodEnd.getTime() - r.periodStart.getTime()) / 86400000 >= 350 &&
        (r.periodEnd.getTime() - r.periodStart.getTime()) / 86400000 <= 380,
    )
    .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
  const s = (r: SimpleStoredRow) => (isObject(r.sources) ? r.sources : {});
  const read = (
    r: SimpleStoredRow,
    key: 'revenue' | 'operatingCashFlow' | 'capex' | 'operatingIncome',
  ): ValuationFact => {
    const source = s(r)[key];
    const f = ownerReportedFact(
      isObject(source) ? source.items : null,
      numeric(r[key]),
      cik,
      iso(r.periodStart),
      iso(r.periodEnd),
    );
    if (f.sources.some((x) => x.filed > today))
      return missing(iso(r.periodEnd));
    return {
      value: f.value,
      start: iso(r.periodStart),
      end: iso(r.periodEnd),
      concept: f.sources[0]?.concept ?? null,
      items: f.sources.map((x) => ({ ...x })),
    };
  };
  const pick = (
    fact: ValuationFact | undefined,
    start: string,
    end: string,
  ): ValuationFact => {
    const xs = (fact?.items ?? []).filter(
      (x) =>
        x.start === start &&
        x.end === end &&
        x.unit === 'USD' &&
        typeof x.val === 'number' &&
        Number.isFinite(x.val),
    );
    if (
      !xs.length ||
      xs.some((x) => x.val !== xs[0].val || x.concept !== xs[0].concept)
    )
      return missing(end);
    const x = xs[0];
    return {
      value: x.val as number,
      start,
      end,
      concept: String(x.concept),
      items: [x],
    };
  };
  const period = (
    base: ValuationBaseline | null,
    label: string,
  ): SimpleFcffPeriod => {
    const m = missing(base?.asOf ?? end);
    // At 0% tax this is the largest possible FCFF for nonnegative interest.
    // Reuse all existing provenance/cash-interest checks without rejecting a
    // selected tax rate merely because the old fixed 21% produced a negative base.
    const validation = base
      ? withResearchFcff({ ...base, fcff: null }, 0).fcffEstimate
      : null;
    return {
      label,
      start: base?.ocf.start ?? null,
      end: base?.asOf ?? end,
      ocf: base?.ocf ?? m,
      capex: base?.capex ?? m,
      interest: base?.interest ?? m,
      revenue: base?.revenue ?? m,
      tax: base?.quality?.taxExpense ?? m,
      pretax: base?.quality?.pretaxIncome ?? m,
      taxSourceValid: Boolean(
        base?.quality &&
        historicalEffectiveTaxRate(
          base.quality.taxExpense,
          base.quality.pretaxIncome,
        ) !== null,
      ),
      approximationAllowed: validation?.status === 'RESEARCH',
      reason:
        validation?.status === 'RESEARCH'
          ? null
          : (validation?.reason ?? '缺少对应期间可靠FCFF输入'),
      warnings: [
        '利息费用代理经营现金付息，二者未必相等；已知现金付息差异仍阻止自动估算。',
        '现金CapEx仅覆盖购置PP&E；资本化利息不额外加回，未完整覆盖融资租赁新增资产及其他经济再投资。',
        '未全面剔除非经营利息/投资收益或特殊索偿，融资租赁及SBC未完整正常化；不得在股权桥接中重复计价。',
      ],
    };
  };
  let latestAnnual: SimpleFcffPeriod | null = null;
  const a = annual[0];
  if (a && b) {
    const start = iso(a.periodStart),
      finish = iso(a.periodEnd),
      ocf = read(a, 'operatingCashFlow'),
      capex = read(a, 'capex');
    const income = s(a).annualRoicInputs;
    const tax = (key: string) => {
      const v = isObject(income) ? income[key] : null;
      return isObject(income) &&
        income.version === 'annual-roic-inputs-v1' &&
        income.cik === cik &&
        income.periodStart === start &&
        income.periodEnd === finish &&
        income.currency === 'USD' &&
        isObject(v) &&
        v.status === 'VERIFIED' &&
        typeof v.value === 'number' &&
        Number.isFinite(v.value) &&
        Array.isArray(v.items) &&
        v.items.length
        ? ({
            value: v.value,
            start,
            end: finish,
            concept: null,
            items: v.items,
          } as ValuationFact)
        : missing(finish);
    };
    const base: ValuationBaseline = {
      ...b,
      asOf: finish,
      revenue: read(a, 'revenue'),
      ebit: read(a, 'operatingIncome'),
      ocf,
      capex,
      interest: pick(b.interest, start, finish),
      fcff: null,
      fcf:
        ocf.value !== null && capex.value !== null && capex.value >= 0
          ? ocf.value - capex.value
          : null,
      fcffChecks: {
        cashInterest: pick(b.fcffChecks?.cashInterest, start, finish),
        capitalizedInterest: pick(
          b.fcffChecks?.capitalizedInterest,
          start,
          finish,
        ),
        pretax: tax('pretaxIncome'),
      },
      quality: b.quality
        ? {
            ...b.quality,
            taxExpense: tax('incomeTaxExpense'),
            pretaxIncome: tax('pretaxIncome'),
          }
        : undefined,
    };
    latestAnnual = period(base, `FY${a.fiscalYear ?? finish.slice(0, 4)}`);
    latestAnnual.warnings.push(
      '年度基准可能滞后最新期；未对间隔期间另外补偿现金流或折现。',
    );
  }
  const income = a ? s(a).annualRoicInputs : null;
  const sic =
    profile?.sic ??
    (isObject(income) && typeof income.sic === 'string' ? income.sic : null);
  return {
    version: 1,
    currency:
      annual.length || b?.ocf.items.some((x) => x.unit === 'USD')
        ? 'USD'
        : null,
    cik,
    sic,
    incorporation: profile?.incorporation ?? null,
    usIncorporated: usIncorporation(profile?.incorporation ?? null),
    profileSource: `https://data.sec.gov/submissions/CIK${cik}.json`,
    ttm: period(b, 'TTM'),
    latestAnnual,
    annual: annual.map((r) => {
      const ocf = read(r, 'operatingCashFlow'),
        capex = read(r, 'capex');
      return {
        year: r.fiscalYear,
        start: iso(r.periodStart),
        end: iso(r.periodEnd),
        revenue: read(r, 'revenue').value,
        fcf:
          ocf.value !== null && capex.value !== null && capex.value >= 0
            ? ocf.value - capex.value
            : null,
        capex: capex.value,
        storedCagrPercent: {
          fcf: { 3: numeric(r.fcfCagr3y), 5: numeric(r.fcfCagr5y) },
          revenue: { 3: numeric(r.revenueCagr3y), 5: numeric(r.revenueCagr5y) },
        },
        sources: Object.fromEntries(
          ['revenue', 'operatingCashFlow', 'capex'].map((k) => [
            k,
            s(r)[k] ?? null,
          ]),
        ),
      };
    }),
  };
}
