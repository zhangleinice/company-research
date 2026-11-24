import {
  ANNUAL_ROIC_INPUT_VERSION,
  QUARTERLY_ROIC_INPUT_VERSION,
  QUARTERLY_ROIC_POLICY_VERSION,
  type QuarterlyRoicInputs,
  type QuarterlyRoicHistory,
  ANNUAL_ROIC_POLICY_VERSION,
  type AnnualRoicHistory,
  type AnnualRoicInputs,
  type AnnualRoicResult,
  type BalanceSheetInputs,
  type RoicCapital,
  type RoicIssue,
} from '@company-research/shared';
import {
  validQuarterPeriod,
  validQuarterIncome,
} from './quarterly-roic-inputs';
import { isObject } from './annual-financials';

export interface RoicStoredPeriod {
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodStart: string | Date;
  periodEnd: string | Date;
  currency: string | null;
  sources: unknown;
}
const day = 86400000;
const date = (x: string | Date) =>
  x instanceof Date
    ? Number.isFinite(x.getTime())
      ? x.toISOString().slice(0, 10)
      : ''
    : /^\d{4}-\d{2}-\d{2}$/.test(x) &&
        Number.isFinite(Date.parse(x)) &&
        new Date(x).toISOString().slice(0, 10) === x
      ? x
      : '';
const issue = (code: string, field: string, message: string): RoicIssue => ({
  code,
  field,
  message,
});
const annual = (r: RoicStoredPeriod) =>
  r.fiscalQuarter === null &&
  !!date(r.periodStart) &&
  !!date(r.periodEnd) &&
  (Date.parse(date(r.periodEnd)) - Date.parse(date(r.periodStart))) / day + 1 >=
    330 &&
  (Date.parse(date(r.periodEnd)) - Date.parse(date(r.periodStart))) / day + 1 <=
    400;
type IncomeEnvelope = AnnualRoicInputs | QuarterlyRoicInputs;
type InternalResult = Omit<AnnualRoicResult, 'incomeInputs'> & {
  incomeInputs: IncomeEnvelope | null;
};
const quarterly = (r: RoicStoredPeriod) =>
  Number.isInteger(r.fiscalQuarter) &&
  r.fiscalQuarter! >= 1 &&
  r.fiscalQuarter! <= 4 &&
  !!date(r.periodStart) &&
  !!date(r.periodEnd) &&
  (Date.parse(date(r.periodEnd)) - Date.parse(date(r.periodStart))) / day + 1 >=
    60 &&
  (Date.parse(date(r.periodEnd)) - Date.parse(date(r.periodStart))) / day + 1 <=
    110;
function envelope(r?: RoicStoredPeriod): IncomeEnvelope | null {
  const quarter = r?.fiscalQuarter !== null;
  const v =
    r && isObject(r.sources)
      ? r.sources[quarter ? 'quarterlyRoicInputs' : 'annualRoicInputs']
      : null;
  return isObject(v) &&
    v.version ===
      (quarter ? QUARTERLY_ROIC_INPUT_VERSION : ANNUAL_ROIC_INPUT_VERSION)
    ? (v as unknown as IncomeEnvelope)
    : null;
}
function samePeriod(r: RoicStoredPeriod, e: IncomeEnvelope | null) {
  return (
    !!e &&
    e.periodStart === date(r.periodStart) &&
    e.periodEnd === date(r.periodEnd) &&
    e.currency === 'USD' &&
    r.currency === 'USD' &&
    e.fiscalYear === r.fiscalYear &&
    (r.fiscalQuarter === null ||
      ('fiscalQuarter' in e &&
        e.fiscalQuarter === r.fiscalQuarter &&
        validQuarterPeriod(e))) &&
    typeof e.cik === 'string' &&
    /^\d{10}$/.test(e.cik)
  );
}
function verified(
  v: unknown,
  end: string,
  start?: string,
  accn?: string,
  filed?: string,
  asOf = '9999-12-31',
): boolean {
  return (
    isObject(v) &&
    v.status === 'VERIFIED' &&
    typeof v.value === 'number' &&
    Number.isFinite(v.value) &&
    Array.isArray(v.items) &&
    v.items.length > 0 &&
    v.items.every(
      (x: unknown) =>
        isObject(x) &&
        x.unit === 'USD' &&
        x.end === end &&
        (start === undefined
          ? x.start === undefined || x.start === null
          : x.start === start) &&
        typeof x.accn === 'string' &&
        /^\d{10}-\d{2}-\d{6}$/.test(x.accn) &&
        (!accn || x.accn === accn) &&
        typeof x.filed === 'string' &&
        !!date(x.filed) &&
        x.filed >= end &&
        x.filed <= asOf &&
        (!filed || x.filed === filed) &&
        /^10-[KQ](\/A)?$/.test(String(x.form)),
    )
  );
}
function capital(
  r: RoicStoredPeriod | undefined,
  end: string,
  cik: string | null,
  field: string,
  asOf: string,
): RoicCapital {
  const raw = r && isObject(r.sources) ? r.sources.balanceSheetInputs : null;
  const c =
    isObject(raw) && raw.version === 2
      ? (raw as unknown as BalanceSheetInputs)
      : null;
  const result: RoicCapital = {
    periodEnd: end,
    investedCapital: null,
    components: c,
    issues: [],
  };
  if (!r) {
    result.issues.push(
      issue('CAPITAL_PERIOD_MISSING', field, '缺少对应报告期末的完整资本快照'),
    );
    return result;
  }
  const e = envelope(r);
  const openingSnapshot =
    field === 'beginningCapital' &&
    isObject(r) &&
    r.version === 'roic-capital-snapshot-v1' &&
    r.cik === cik &&
    typeof cik === 'string' &&
    /^\d{10}$/.test(cik) &&
    r.currency === 'USD' &&
    date(r.periodEnd) === end;
  if (!openingSnapshot && (!samePeriod(r, e) || e?.cik !== cik)) {
    result.issues.push(
      issue(
        'CAPITAL_CACHE_VERSION',
        field,
        '资本缓存缺少当前报表输入版本、公司身份或期间不匹配',
      ),
    );
    return result;
  }
  if (!c || c.periodEnd !== end || !c.accessionNumber || !c.filed) {
    result.issues.push(
      issue('CAPITAL_UNVERIFIED', field, '缺少version 2的同年末核准资本来源'),
    );
    return result;
  }
  const keys = [
    'consolidatedEquity',
    'financingDebt',
    'cash',
    'currentFinancialInvestments',
  ] as const;
  for (const key of keys) {
    const v = c[key];
    if (!verified(v, end, undefined, c.accessionNumber, c.filed, asOf))
      result.issues.push(
        issue(
          'CAPITAL_COMPONENT_MISSING',
          `${field}.${key}`,
          v?.reason || '组成项未核准或SEC来源期间不匹配',
        ),
      );
    else if (key !== 'consolidatedEquity' && v.value! < 0)
      result.issues.push(
        issue(
          'INVALID_CAPITAL_COMPONENT',
          `${field}.${key}`,
          '债务、现金及流动投资不得为负数',
        ),
      );
  }
  if (c.financeLeasesIncludedInDebt !== true)
    result.issues.push(
      issue(
        'FINANCING_DEBT_SCOPE',
        `${field}.financingDebt`,
        '含融资租赁的债务范围尚未核准，不能使用旧totalDebt替代',
      ),
    );
  if (result.issues.length) return result;
  const value =
    c.consolidatedEquity.value! +
    c.financingDebt.value! -
    c.cash.value! -
    c.currentFinancialInvestments.value!;
  if (!Number.isFinite(value))
    result.issues.push(
      issue('NONFINITE_CAPITAL', field, '投入资本计算超出有效数值范围'),
    );
  else {
    result.investedCapital = value;
    if (value <= 0)
      result.issues.push(
        issue(
          'NON_POSITIVE_CAPITAL',
          field,
          '期初或期末投入资本小于或等于零，不计算常规ROIC',
        ),
      );
  }
  return result;
}
function resultFor(
  row: RoicStoredPeriod,
  rows: readonly RoicStoredPeriod[],
  asOf: string,
): InternalResult {
  const start = date(row.periodStart),
    end = date(row.periodEnd),
    e = envelope(row);
  const beginEnd = new Date(Date.parse(start) - day).toISOString().slice(0, 10);
  const isQuarter = quarterly(row);
  const matching = rows.filter((r) => date(r.periodEnd) === beginEnd);
  const quarterBeginnings = isQuarter ? matching.filter(quarterly) : [];
  let beginnings = quarterBeginnings.length
    ? quarterBeginnings
    : matching.filter(annual);
  // The normalizer persists one extra capital period in the existing JSON column.
  // This preserves the public ten-row financial history without losing its oldest opening balance.
  if (
    (beginnings.length === 0 ||
      (beginnings.length === 1 &&
        !samePeriod(beginnings[0], envelope(beginnings[0])))) &&
    isObject(row.sources)
  ) {
    const snapshot = row.sources.roicBeginningCapital;
    if (
      isObject(snapshot) &&
      snapshot.version === 'roic-capital-snapshot-v1' &&
      snapshot.periodEnd === beginEnd &&
      snapshot.cik === e?.cik &&
      snapshot.currency === 'USD'
    )
      beginnings = [snapshot as unknown as RoicStoredPeriod];
  }
  const b = capital(
    beginnings.length === 1 ? beginnings[0] : undefined,
    beginEnd,
    e?.cik ?? null,
    'beginningCapital',
    asOf,
  );
  if (beginnings.length > 1)
    b.issues = [
      issue(
        'CAPITAL_PERIOD_AMBIGUOUS',
        'beginningCapital',
        '同一年末存在多个资本快照，不能任意选择',
      ),
    ];
  const c = capital(row, end, e?.cik ?? null, 'endingCapital', asOf);
  const result: InternalResult = {
    policyVersion: ANNUAL_ROIC_POLICY_VERSION,
    fiscalYear: row.fiscalYear,
    periodStart: start,
    periodEnd: end,
    currency: row.currency,
    status: 'MISSING_DATA',
    operatingIncome: null,
    incomeTaxExpense: null,
    pretaxIncome: null,
    historicalEffectiveTaxRate: null,
    nopat: null,
    beginningInvestedCapital: b.investedCapital,
    endingInvestedCapital: c.investedCapital,
    averageInvestedCapital: null,
    roic: null,
    incomeInputs: e,
    beginningCapital: b,
    endingCapital: c,
    missingReasons: [],
    warnings: [
      issue(
        'TAX_RATE_PROXY',
        'historicalEffectiveTaxRate',
        '历史有效税率作为经营税率代理，保留一次性及递延税项，不代表正常化经营税率',
      ),
    ],
  };
  const reasons = result.missingReasons;
  const sic = e?.sic;
  if (sic && /^\d{4}$/.test(sic) && /^(60|61|62|63|64|65|66|67)/.test(sic)) {
    result.status = 'NOT_APPLICABLE';
    reasons.push(
      issue(
        'FINANCIAL_SECTOR',
        'sic',
        '金融及相关SIC分类暂不适用普通经营企业的ROIC公式',
      ),
    );
    result.beginningInvestedCapital = null;
    result.endingInvestedCapital = null;
    b.investedCapital = null;
    c.investedCapital = null;
    return result;
  }
  if (!sic || !/^\d{4}$/.test(sic))
    reasons.push(
      issue(
        'INDUSTRY_UNVERIFIED',
        'sic',
        '缺少核准的SEC SIC，不能确认普通经营企业适用性',
      ),
    );
  if (!samePeriod(row, e))
    reasons.push(
      issue(
        'ANNUAL_CACHE_VERSION',
        'incomeInputs',
        '缺少当前年度输入版本、公司身份或完整年度期间不匹配',
      ),
    );
  const keys = ['operatingIncome', 'incomeTaxExpense', 'pretaxIncome'] as const;
  const incomeSources: Record<string, unknown>[] = [];
  if (samePeriod(row, e))
    for (const key of keys) {
      const v = e![key];
      if (
        isQuarter
          ? !validQuarterIncome(v, e as QuarterlyRoicInputs, asOf)
          : !verified(v, end, start, undefined, undefined, asOf) ||
            v.items.some((x) => !/^10-K(\/A)?$/.test(String(x.form)))
      )
        reasons.push(
          issue(
            'ANNUAL_INCOME_MISSING',
            key,
            v?.reason || '缺少同一完整年度的核准损益来源',
          ),
        );
      else {
        result[key] = v.value;
        incomeSources.push(...v.items);
      }
    }
  if (e && Array.isArray(e.taxDisclosures))
    e.taxDisclosures.forEach((d, i) => {
      if (d && verified(d.input, end, start, undefined, undefined, asOf))
        result.warnings.push(
          issue(
            'DISCLOSED_TAX_RECONCILIATION',
            `incomeInputs.taxDisclosures[${i}]`,
            `SEC披露${d.label}；保留报表税费原值，不作正常化调整`,
          ),
        );
    });
  const tuples = new Set(
    isQuarter && e
      ? keys
          .filter((k) => result[k] !== null)
          .map((k) => e[k].items.map((x) => `${x.accn}:${x.filed}`).join('|'))
      : incomeSources.map((x) => `${x.accn}:${x.filed}`),
  );
  const coherent = tuples.size === 1;
  if (tuples.size > 1)
    reasons.push(
      issue(
        'ANNUAL_INCOME_CONFLICT',
        'incomeInputs',
        '年度损益输入来自不兼容的申报版本',
      ),
    );
  if (
    coherent &&
    result.incomeTaxExpense !== null &&
    result.pretaxIncome !== null
  ) {
    if (result.pretaxIncome <= 0)
      reasons.push(
        issue(
          'NON_POSITIVE_PRETAX',
          'pretaxIncome',
          '税前利润小于或等于零，不使用历史有效税率',
        ),
      );
    else {
      const rate = result.incomeTaxExpense / result.pretaxIncome;
      if (!Number.isFinite(rate))
        reasons.push(
          issue(
            'NONFINITE_TAX_RATE',
            'historicalEffectiveTaxRate',
            '税率超出有效数值范围',
          ),
        );
      else {
        result.historicalEffectiveTaxRate = rate;
        if (rate < 0 || rate > 1)
          reasons.push(
            issue(
              'ABNORMAL_TAX_RATE',
              'historicalEffectiveTaxRate',
              '历史有效税率低于0或高于100%，保留实际比值但不用于NOPAT',
            ),
          );
        else if (result.operatingIncome !== null) {
          const nopat = result.operatingIncome * (1 - rate);
          if (Number.isFinite(nopat)) result.nopat = nopat;
          else
            reasons.push(
              issue('NONFINITE_NOPAT', 'nopat', 'NOPAT超出有效数值范围'),
            );
        }
      }
    }
  }
  reasons.push(...b.issues, ...c.issues);
  if (
    rows.filter(
      (r) =>
        (isQuarter ? quarterly(r) : annual(r)) && date(r.periodEnd) === end,
    ).length !== 1
  )
    reasons.push(
      issue(
        'CAPITAL_PERIOD_AMBIGUOUS',
        'endingCapital',
        '同一年末存在多个年度快照，不能任意选择',
      ),
    );
  if (
    !b.issues.length &&
    !c.issues.length &&
    b.investedCapital !== null &&
    c.investedCapital !== null
  )
    result.averageInvestedCapital =
      b.investedCapital / 2 + c.investedCapital / 2;
  if (
    !reasons.length &&
    result.nopat !== null &&
    result.averageInvestedCapital !== null
  ) {
    const roic = result.nopat / result.averageInvestedCapital;
    if (Number.isFinite(roic)) {
      result.roic = roic;
      result.status = 'READY';
    } else
      reasons.push(issue('NONFINITE_ROIC', 'roic', 'ROIC超出有效数值范围'));
  }
  if (result.status !== 'READY')
    result.status = reasons.some((x) =>
      /^(NON_POSITIVE|NONFINITE|ABNORMAL|INVALID)/.test(x.code),
    )
      ? 'INVALID_INPUT'
      : 'MISSING_DATA';
  return result;
}
/** Annual DB rows only; never reads or regenerates the independent TTM cache. */
export function annualRoicHistory(
  rows: readonly RoicStoredPeriod[],
  asOf = new Date().toISOString().slice(0, 10),
  limit = 10,
): AnnualRoicHistory {
  const eligible = rows
    .filter((r) => annual(r) && date(r.periodEnd) <= asOf)
    .sort((a, b) => date(b.periodEnd).localeCompare(date(a.periodEnd)));
  const unique = [
    ...new Map(eligible.map((r) => [date(r.periodEnd), r])).values(),
  ].slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : 10);
  return {
    policyVersion: ANNUAL_ROIC_POLICY_VERSION,
    label: '年度报表口径参考 ROIC',
    currency: 'USD',
    rateUnit: 'decimal',
    taxBasis: 'historical-effective-tax-rate-proxy',
    capitalInputVersion: 2,
    assumptions: [
      '合并权益包含少数股东权益',
      '融资租赁包含在financingDebt中，不采用旧totalDebt',
      '不进行经营租赁或研发资本化调整',
      '保留商誉及长期金融投资，扣除现金及已核准流动金融投资',
    ],
    results: unique.map((row) =>
      resultFor(row, rows, asOf),
    ) as AnnualRoicResult[],
    missingReasons: unique.length
      ? []
      : [
          issue(
            'ANNUAL_CACHE_UNAVAILABLE',
            'annualFinancials',
            '没有可用的完整年度财务缓存；未触发SEC或AI请求',
          ),
        ],
  };
}

/** Single-quarter returns; no annualization or rolling aggregation. */
export function quarterlyRoicHistory(
  rows: readonly RoicStoredPeriod[],
  capitalRows: readonly RoicStoredPeriod[] = [],
  asOf = new Date().toISOString().slice(0, 10),
  limit = 10,
): QuarterlyRoicHistory {
  const eligible = rows
    .filter((r) => quarterly(r) && date(r.periodEnd) <= asOf)
    .sort((a, b) => date(b.periodEnd).localeCompare(date(a.periodEnd)));
  const unique = [
    ...new Map(eligible.map((r) => [date(r.periodEnd), r])).values(),
  ].slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : 10);
  const template = annualRoicHistory([], asOf);
  return {
    ...template,
    policyVersion: QUARTERLY_ROIC_POLICY_VERSION,
    label: '单季度报表口径参考 ROIC',
    taxBasis: 'quarter-effective-tax-rate-proxy',
    annualized: false,
    assumptions: [
      ...template.assumptions,
      '单季度损益与平均季初季末资本；不乘4、不使用TTM',
    ],
    results: unique.map((row) => {
      const r = resultFor(row, [...rows, ...capitalRows.filter(annual)], asOf);
      const { historicalEffectiveTaxRate, ...rest } = r;
      return {
        ...rest,
        policyVersion: QUARTERLY_ROIC_POLICY_VERSION,
        fiscalQuarter: row.fiscalQuarter!,
        quarterlyEffectiveTaxRate: historicalEffectiveTaxRate,
        incomeInputs: r.incomeInputs as QuarterlyRoicInputs | null,
        warnings: r.warnings.map((x) => ({
          ...x,
          field: x.field.replace(
            'historicalEffectiveTaxRate',
            'quarterlyEffectiveTaxRate',
          ),
          message: x.message.replace('历史有效税率', '单季度有效税率'),
        })),
        missingReasons: r.missingReasons.map((x) => ({
          ...x,
          code: x.code.replace(/^ANNUAL_/, 'QUARTERLY_'),
          message: x.message
            .replaceAll('年度', '季度')
            .replaceAll('年末', '季末'),
        })),
      };
    }),
    missingReasons: unique.length
      ? []
      : [
          issue(
            'QUARTERLY_CACHE_UNAVAILABLE',
            'quarterlyFinancials',
            '没有可用的完整单季度财务缓存；未触发SEC或AI请求',
          ),
        ],
  };
}
