import {
  ANNUAL_ROIC_INPUT_VERSION,
  type AnnualRoicInputs,
  type BalanceSheetInput,
} from '@company-research/shared';
import { isObject } from './annual-financials';

const TAGS = {
  operatingIncome: 'OperatingIncomeLoss',
  incomeTaxExpense: 'IncomeTaxExpenseBenefit',
  pretaxIncome:
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
} as const;
export type IncomeKey = keyof typeof TAGS;
interface Fact extends Record<string, unknown> {
  start: string;
  end: string;
  filed: string;
  accn: string;
  form: string;
  val: number;
}
const date = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString().slice(0, 10) === x;
const missing = (reason: string): BalanceSheetInput => ({
  value: null,
  status: 'REVIEW_REQUIRED',
  reason,
  method: 'unverified',
  items: [],
});

/** Persist a single annual filing bundle. fy/fp are filing context labels;
 * actual start/end select the year, never TTM or YTD subtraction. */
export function reportedRoicIncome(
  raw: unknown,
  period: { fiscalYear: number | null; periodStart: string; periodEnd: string },
  sic: string | null,
  quarterly = false,
  filedOnOrBefore?: string,
): AnnualRoicInputs {
  const cik =
    isObject(raw) && /^\d{1,10}$/.test(String(raw.cik)) && Number(raw.cik) > 0
      ? String(raw.cik).padStart(10, '0')
      : null;
  const tax =
    isObject(raw) && isObject(raw.facts) && isObject(raw.facts['us-gaap'])
      ? raw.facts['us-gaap']
      : {};
  const groups = new Map<
    string,
    { filed: string; accn: string; facts: Partial<Record<IncomeKey, Fact[]>> }
  >();
  for (const [key, tag] of Object.entries(TAGS) as [IncomeKey, string][]) {
    const c = tax[tag];
    const units = isObject(c) && isObject(c.units) ? c.units : {};
    for (const f of Array.isArray(units.USD) ? units.USD : []) {
      if (
        !isObject(f) ||
        !date(f.start) ||
        !date(f.end) ||
        !date(f.filed) ||
        f.start !== period.periodStart ||
        f.end !== period.periodEnd ||
        f.filed < f.end ||
        (filedOnOrBefore !== undefined && f.filed > filedOnOrBefore) ||
        !(quarterly ? /^10-[KQ](\/A)?$/ : /^10-K(\/A)?$/).test(
          String(f.form),
        ) ||
        (!quarterly && f.fp !== undefined && f.fp !== 'FY') ||
        typeof f.accn !== 'string' ||
        !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) ||
        typeof f.val !== 'number' ||
        !Number.isFinite(f.val) ||
        (f.dimensions !== undefined &&
          (!isObject(f.dimensions) || Object.keys(f.dimensions).length))
      )
        continue;
      const id = `${f.accn}:${f.filed}`;
      const g = groups.get(id) ?? { filed: f.filed, accn: f.accn, facts: {} };
      (g.facts[key] ??= []).push(f as Fact);
      groups.set(id, g);
    }
  }
  const ordered = [...groups.values()].sort(
    (a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn),
  );
  const unique = (xs?: Fact[]) =>
    xs?.length && xs.every((x) => x.val === xs[0].val) ? xs[0] : undefined;
  const complete = ordered.find((g) =>
    Object.keys(TAGS).every((k) => unique(g.facts[k as IncomeKey])),
  );
  const newest = ordered[0];
  const compatible =
    complete &&
    ordered
      .slice(0, ordered.indexOf(complete))
      .every((g) =>
        Object.keys(TAGS).every(
          (k) =>
            !g.facts[k as IncomeKey] ||
            unique(g.facts[k as IncomeKey])?.val ===
              unique(complete.facts[k as IncomeKey])?.val,
        ),
      );
  const selected = compatible ? complete : newest;
  const fact = (key: IncomeKey): BalanceSheetInput => {
    const f = unique(selected?.facts[key]);
    if (!cik || !f)
      return missing(
        !cik
          ? '缺少SEC公司身份，年度来源未核准'
          : `缺少同一完整年度申报的${TAGS[key]}或同一申报数据冲突`,
      );
    return {
      value: f.val,
      status: 'VERIFIED',
      reason: null,
      method: quarterly
        ? 'reported_period_same_filing'
        : 'reported_annual_same_filing',
      items: [
        {
          ...f,
          unit: 'USD',
          concept: `us-gaap:${TAGS[key]}`,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
        },
      ],
    };
  };
  const taxDisclosures: AnnualRoicInputs['taxDisclosures'] = [];
  if (cik && selected)
    for (const [tag, label] of Object.entries({
      IncomeTaxReconciliationChangeInEnactedTaxRate: '税率变动调节项',
      IncomeTaxReconciliationChangeInDeferredTaxAssetsValuationAllowance:
        '递延税项估值准备变动',
      IncomeTaxReconciliationTaxContingencies: '税务或有事项调节项',
      IncomeTaxReconciliationOtherAdjustments:
        '其他税费调节项（未自动认定一次性）',
    })) {
      const c = tax[tag];
      const units = isObject(c) && isObject(c.units) ? c.units : {};
      const fs = (Array.isArray(units.USD) ? units.USD : []).filter(
        (f): f is Fact =>
          isObject(f) &&
          f.start === period.periodStart &&
          f.end === period.periodEnd &&
          f.accn === selected.accn &&
          f.filed === selected.filed &&
          /^10-K(\/A)?$/.test(String(f.form)) &&
          typeof f.val === 'number' &&
          Number.isFinite(f.val) &&
          (f.dimensions === undefined ||
            (isObject(f.dimensions) && Object.keys(f.dimensions).length === 0)),
      );
      const f = unique(fs);
      if (f && f.val !== 0)
        taxDisclosures.push({
          concept: `us-gaap:${tag}`,
          label,
          input: {
            value: f.val,
            status: 'VERIFIED',
            reason: null,
            method: 'reported_tax_reconciliation',
            items: [
              {
                ...f,
                unit: 'USD',
                concept: `us-gaap:${tag}`,
                url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
              },
            ],
          },
        });
    }
  return {
    version: ANNUAL_ROIC_INPUT_VERSION,
    fiscalYear: period.fiscalYear,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    currency: 'USD',
    cik,
    sic: sic && /^\d{4}$/.test(sic) ? sic : null,
    industrySourceUrl: cik
      ? `https://data.sec.gov/submissions/CIK${cik}.json`
      : null,
    operatingIncome: fact('operatingIncome'),
    incomeTaxExpense: fact('incomeTaxExpense'),
    pretaxIncome: fact('pretaxIncome'),
    taxDisclosures,
  };
}

export function annualRoicInputs(
  raw: unknown,
  period: { fiscalYear: number | null; periodStart: string; periodEnd: string },
  sic: string | null,
): AnnualRoicInputs {
  return reportedRoicIncome(raw, period, sic);
}
