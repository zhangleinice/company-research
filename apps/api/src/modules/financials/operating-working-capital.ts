import {
  OPERATING_CASH_REVENUE_RATIO,
  OPERATING_NWC_POLICY,
  type OperatingWorkingCapital,
  type OperatingNwcItem,
  type NwcScopeQualification,
  type NwcCoverageAssessment,
  type ValuationFact,
} from '@company-research/shared';
import { isObject } from './annual-financials';
import {
  cashFlowPeriod,
  shiftFinancialDate,
  validFinancialDate,
} from './cash-flow-period';

type Observation = Record<string, unknown> & {
  start?: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
  form: string;
};
interface Rule {
  category: string;
  label: string;
  tags: string[];
  sign: 1 | -1;
  scope: 'CORE_ASSET' | 'CORE_LIABILITY' | 'QUALIFIED' | 'EXCLUDED';
}
const RULES: Rule[] = [
  {
    category: 'receivables',
    label: '应收账款',
    tags: ['IncreaseDecreaseInAccountsReceivable'],
    sign: -1,
    scope: 'CORE_ASSET',
  },
  {
    category: 'inventories',
    label: '存货',
    tags: ['IncreaseDecreaseInInventories'],
    sign: -1,
    scope: 'CORE_ASSET',
  },
  {
    category: 'otherReceivables',
    label: '经营性其他应收款',
    tags: ['IncreaseDecreaseInOtherReceivables'],
    sign: -1,
    scope: 'QUALIFIED',
  },
  {
    category: 'payables',
    label: '经营性应付账款',
    tags: ['IncreaseDecreaseInAccountsPayable'],
    sign: 1,
    scope: 'CORE_LIABILITY',
  },
  {
    category: 'deferredRevenue',
    label: '递延收入',
    tags: [
      'IncreaseDecreaseInContractWithCustomerLiability',
      'IncreaseDecreaseInDeferredRevenue',
    ],
    sign: 1,
    scope: 'CORE_LIABILITY',
  },
  {
    category: 'otherAssets',
    label: '其他经营资产混合项',
    tags: ['IncreaseDecreaseInOtherOperatingAssets'],
    sign: -1,
    scope: 'QUALIFIED',
  },
  {
    category: 'prepaidAndOtherAssets',
    label: '预付款及其他流动/非流动资产',
    tags: ['IncreaseDecreaseInPrepaidDeferredExpenseAndOtherAssets'],
    sign: -1,
    scope: 'QUALIFIED',
  },
  {
    category: 'otherCurrentAssets',
    label: '其他流动资产',
    tags: ['IncreaseDecreaseInOtherCurrentAssets'],
    sign: -1,
    scope: 'QUALIFIED',
  },
  {
    category: 'otherNoncurrentAssets',
    label: '其他非流动资产',
    tags: ['IncreaseDecreaseInOtherNoncurrentAssets'],
    sign: -1,
    scope: 'QUALIFIED',
  },
  {
    category: 'accruedLiabilities',
    label: '应计费用及其他负债',
    tags: ['IncreaseDecreaseInAccruedLiabilities'],
    sign: 1,
    scope: 'QUALIFIED',
  },
  {
    category: 'otherLiabilities',
    label: '其他经营负债混合项',
    tags: ['IncreaseDecreaseInOtherOperatingLiabilities'],
    sign: 1,
    scope: 'QUALIFIED',
  },
  {
    category: 'otherCurrentLiabilities',
    label: '其他流动负债',
    tags: ['IncreaseDecreaseInOtherCurrentLiabilities'],
    sign: 1,
    scope: 'QUALIFIED',
  },
  {
    category: 'otherNoncurrentLiabilities',
    label: '其他非流动负债',
    tags: ['IncreaseDecreaseInOtherNoncurrentLiabilities'],
    sign: 1,
    scope: 'QUALIFIED',
  },
  {
    category: 'combinedPayables',
    label: '应付账款及应计费用合计',
    tags: ['IncreaseDecreaseInAccountsPayableAndAccruedLiabilities'],
    sign: 1,
    scope: 'QUALIFIED',
  },
  {
    category: 'incomeTaxes',
    label: '所得税变动',
    tags: [
      'IncreaseDecreaseInIncomeTaxes',
      'IncreaseDecreaseInAccruedIncomeTaxesPayable',
    ],
    sign: 1,
    scope: 'EXCLUDED',
  },
  {
    category: 'operatingCapitalAggregate',
    label: '经营资产负债变动汇总（仅勾稽）',
    tags: ['IncreaseDecreaseInOperatingCapital'],
    sign: -1,
    scope: 'EXCLUDED',
  },
];
const REVENUE_TAGS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
];
const days = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / 86400000;
const missingFact = (end: string, reason: string): ValuationFact => ({
  value: null,
  start: null,
  end,
  concept: null,
  items: [],
  reason,
});
const sourceUrl = (cik: string, accn: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll('-', '')}/${accn}-index.html`;
/** Scope evidence from the completed audit, not a company amount or a forecast.
 * It cannot propagate to another filing or turn generic other receivables into operating assets. */
const AUDITED_SCOPES: NwcScopeQualification[] = [
  {
    cik: '0000320193',
    accession: '0000320193-26-000026',
    concept: 'us-gaap:IncreaseDecreaseInOtherReceivables',
    classification: 'OPERATING',
    evidence:
      '该年报将 Vendor non-trade receivables 列入经营现金流，并说明其来自外包生产伙伴采购零部件；按经营应收处理。',
  },
];
export interface NwcOptions {
  qualifications?: readonly NwcScopeQualification[];
  coverage?: NwcCoverageAssessment;
}

/** Raw USD, independent of FCFF. All incomplete estimates are explicit research inputs. */
export function estimateOperatingWorkingCapital(
  raw: unknown,
  cik: string,
  ocf: ValuationFact,
  revenue: ValuationFact,
  periodKind: 'ANNUAL' | 'TTM',
  options: NwcOptions = {},
): OperatingWorkingCapital {
  const result: OperatingWorkingCapital = {
    policyVersion: OPERATING_NWC_POLICY,
    cik,
    unit: 'USD',
    periodKind,
    periodStart: ocf.start,
    periodEnd: ocf.end,
    status: 'MISSING',
    identifiedCashImpact: null,
    operatingCash: {
      ratio: OPERATING_CASH_REVENUE_RATIO,
      revenue,
      priorRevenue: missingFact(ocf.start ?? ocf.end, '缺少对应上期营收'),
      increment: null,
      formula: '(本期对应年度/TTM营收 − 对应上期营收) × 2%',
      reason: null,
    },
    completeValue: null,
    approximateValue: null,
    partialValue: null,
    defaultValue: null,
    requiresUserAdjustment: true,
    items: [],
    warnings: [
      '部分小计不等于完整ΔNWC；未纳入或未单列项目不视为零。',
      '余额差分不直接替代现金影响；资本支出应付款、收购付款及特殊索偿须避免重复处理。',
      '非流动不等于非经营；未完成范围拆分的长期经营投入仍保留遗漏风险。',
    ],
    calculation: '',
  };
  const chain = cashFlowPeriod(ocf);
  if (
    !isObject(raw) ||
    String(raw.cik).padStart(10, '0') !== cik ||
    !isObject(raw.facts) ||
    !isObject(raw.facts['us-gaap']) ||
    chain.reason ||
    !validFinancialDate(ocf.start) ||
    days(ocf.start, ocf.end) < 350 ||
    days(ocf.start, ocf.end) > 380 ||
    (ocf.items.length !== 1 && ocf.items.length !== 3) ||
    (periodKind === 'ANNUAL' && ocf.items.length !== 1)
  ) {
    result.warnings.push(chain.reason ?? '公司身份或完整年度/TTM来源不匹配');
    return result;
  }
  const taxonomy = raw.facts['us-gaap'],
    legs = ocf.items,
    weights = chain.weights;
  const annualLeg = legs[0];
  if (
    !/^10-K(\/A)?$/.test(String(annualLeg.form)) ||
    days(String(annualLeg.start), String(annualLeg.end)) < 350 ||
    days(String(annualLeg.start), String(annualLeg.end)) > 380 ||
    (legs.length === 3 &&
      (legs[1].accn !== legs[2].accn ||
        Math.abs(
          days(String(legs[1].start), String(legs[1].end)) -
            days(String(legs[2].start), String(legs[2].end)),
        ) > 8 ||
        Math.abs(days(String(legs[2].end), String(legs[1].end)) - 365) > 8))
  ) {
    result.warnings.push('缺少完整年报基期或同申报、可比累计期间的TTM来源链');
    return result;
  }
  const cutoff = legs
    .map((x) => String(x.filed))
    .sort()
    .at(-1)!;
  const observations = (tag: string, instant = false): Observation[] => {
    const c = taxonomy[tag];
    return isObject(c) && isObject(c.units) && Array.isArray(c.units.USD)
      ? c.units.USD.filter(isObject).filter(
          (x): x is Observation =>
            typeof x.val === 'number' &&
            Number.isFinite(x.val) &&
            validFinancialDate(x.end) &&
            (instant ? !x.start : validFinancialDate(x.start)) &&
            validFinancialDate(x.filed) &&
            x.filed >= x.end &&
            x.filed <= cutoff &&
            typeof x.accn === 'string' &&
            /^\d{10}-\d{2}-\d{6}$/.test(x.accn) &&
            /^10-[KQ](\/A)?$/.test(String(x.form)) &&
            !x.segment &&
            !x.dimensions &&
            (x.unit === undefined || x.unit === 'USD'),
        )
      : [];
  };
  const serialize = (x: Observation, tag: string) => ({
    ...x,
    concept: `us-gaap:${tag}`,
    unit: 'USD',
    url: sourceUrl(cik, x.accn),
  });
  const same = (x: Observation, leg: Record<string, unknown>) =>
    ['start', 'end', 'accn', 'filed', 'form'].every((k) => x[k] === leg[k]);
  const qualification = (concept: string, accn: string) =>
    [...(options.qualifications ?? []), ...AUDITED_SCOPES].find(
      (q) =>
        q.cik === cik &&
        q.accession === accn &&
        q.concept === concept &&
        q.evidence.trim(),
    );
  function readRule(rule: Rule): OperatingNwcItem {
    const sources: Record<string, unknown>[] = [],
      missingLegs: string[] = [];
    let conflict = false,
      cash = 0,
      qualified = true,
      excluded = false,
      allExcluded = true;
    legs.forEach((leg, index) => {
      const choices = rule.tags.flatMap((tag) =>
        observations(tag)
          .filter((x) => same(x, leg))
          .map((x) => ({ x, tag })),
      );
      if (!choices.length) {
        missingLegs.push(`${leg.start}/${leg.end}/${leg.accn}`);
        return;
      }
      if (choices.some((c) => c.x.val !== choices[0].x.val)) conflict = true;
      const chosen = choices[0],
        concept = `us-gaap:${chosen.tag}`,
        q = qualification(concept, chosen.x.accn);
      qualified = qualified && q?.classification === 'OPERATING';
      excluded = excluded || q?.classification === 'EXCLUDED';
      allExcluded = allExcluded && q?.classification === 'EXCLUDED';
      choices.forEach((c, i) =>
        sources.push({
          ...serialize(c.x, c.tag),
          coefficient: i === 0 ? weights[index] : 0,
          cashDirection: rule.sign,
          contribution: i === 0 ? c.x.val * rule.sign * weights[index] : 0,
          aliasExcluded: i > 0,
          scopeEvidence: q?.evidence ?? null,
        }),
      );
      cash += chosen.x.val * rule.sign * weights[index];
    });
    const fixedExcluded = rule.scope === 'EXCLUDED';
    const status = fixedExcluded
      ? 'EXCLUDED'
      : conflict
        ? 'CONFLICT'
        : missingLegs.length
          ? 'MISSING'
          : allExcluded
            ? 'EXCLUDED'
            : !excluded &&
                (rule.scope === 'CORE_ASSET' ||
                  rule.scope === 'CORE_LIABILITY' ||
                  qualified)
              ? 'INCLUDED'
              : 'UNRESOLVED';
    return {
      category: rule.category,
      label: rule.label,
      status,
      cashImpact: missingLegs.length || conflict ? null : cash,
      missingLegs,
      sources,
      reason: conflict
        ? '同申报金额或替代标签存在冲突'
        : missingLegs.length
          ? '缺少完整期间分项，不以缺失补零'
          : rule.category === 'incomeTaxes'
            ? '所得税变动不混入当前NOPAT研究税率口径'
            : rule.category === 'operatingCapitalAggregate'
              ? '汇总项可能包含税务和特殊付款，仅用于勾稽，不与分项重复汇总'
              : status === 'EXCLUDED' && excluded
                ? '已有披露证据确认非经营性质'
                : status === 'INCLUDED'
                  ? '按经识别的经营现金方向纳入；替代标签仅取一次'
                  : '混合项未拆分经营/非经营、税务、融资租赁、资本应付或特殊索偿，不直接纳入',
    };
  }
  result.items = RULES.map(readRule);
  // Preserve additional cash-flow changes without guessing their polarity or scope.
  const recognized = new Set(RULES.flatMap((r) => r.tags));
  for (const tag of Object.keys(taxonomy).filter(
    (t) => t.startsWith('IncreaseDecreaseIn') && !recognized.has(t),
  )) {
    const sources = legs.flatMap((leg, i) =>
      observations(tag)
        .filter((x) => same(x, leg))
        .map((x) => ({ ...serialize(x, tag), coefficient: weights[i] })),
    );
    if (sources.length)
      result.items.push({
        category: `unclassified:${tag}`,
        label: tag,
        status: 'UNRESOLVED',
        cashImpact: null,
        sources,
        missingLegs: [],
        reason: '未核准的变动项目，保留原始金额；不猜测现金方向或经营归属',
      });
  }
  const inventories = result.items.find((x) => x.category === 'inventories')!;
  if (
    inventories.status === 'MISSING' &&
    inventories.sources.length &&
    result.items.some((x) => x.category === 'otherAssets' && x.sources.length)
  )
    result.warnings.push(
      '存货在年度及累计期间未一致单列，其他资产可能包含相关变动；不将缺失年度存货补零或把部分累计差分当作完整TTM。',
    );
  result.warnings.push(
    'CompanyFacts未包含的自定义项目及未量化特殊事项可能遗漏，不代表不存在。',
  );
  // Broad/child overlaps need an actual split; an operating label alone is insufficient.
  for (const [broad, children] of [
    ['combinedPayables', ['payables', 'accruedLiabilities']],
    [
      'otherAssets',
      ['prepaidAndOtherAssets', 'otherCurrentAssets', 'otherNoncurrentAssets'],
    ],
    [
      'otherLiabilities',
      ['otherCurrentLiabilities', 'otherNoncurrentLiabilities'],
    ],
  ] as [string, string[]][]) {
    const parent = result.items.find((x) => x.category === broad)!;
    if (
      parent.status === 'INCLUDED' &&
      result.items.some(
        (x) => children.includes(x.category) && x.status === 'INCLUDED',
      )
    ) {
      parent.status = 'UNRESOLVED';
      parent.reason = '与已纳入分项存在范围重叠，未拆分部分不重复相加';
    }
  }
  function valueFact(x: Observation, tag: string): ValuationFact {
    return {
      value: x.val,
      start: x.start ?? null,
      end: x.end,
      concept: `us-gaap:${tag}`,
      items: [serialize(x, tag)],
    };
  }
  function pick(xs: Observation[], preferred?: string): Observation | null {
    const sorted = xs
      .slice()
      .sort(
        (a, b) =>
          Number(b.accn === preferred) - Number(a.accn === preferred) ||
          b.filed.localeCompare(a.filed),
      );
    const x = sorted[0];
    return x && !sorted.some((y) => y.accn === x.accn && y.val !== x.val)
      ? x
      : null;
  }
  // Revenue is rechecked against the same OCF filing legs, not historical quarter-cache sums.
  const tag = revenue.concept?.replace(/^us-gaap:/, '');
  const rv = tag && REVENUE_TAGS.includes(tag) ? observations(tag) : [];
  const currentLegs = legs.map((leg) => pick(rv.filter((x) => same(x, leg))));
  const revenueValid =
    revenue.start === ocf.start &&
    revenue.end === ocf.end &&
    revenue.value !== null &&
    revenue.value >= 0 &&
    currentLegs.every((x) => x !== null) &&
    Math.abs(
      currentLegs.reduce((n, x, i) => n + x!.val * weights[i], 0) -
        revenue.value,
    ) < 0.01;
  if (revenueValid && tag)
    result.operatingCash.revenue = {
      value: revenue.value,
      start: ocf.start,
      end: ocf.end,
      concept: `us-gaap:${tag}`,
      items: currentLegs.map((x, i) => ({
        ...serialize(x!, tag),
        coefficient: weights[i],
      })),
    };
  let prior: ValuationFact = missingFact(
    shiftFinancialDate(ocf.start, -1),
    '缺少同口径对应上期营收',
  );
  const precedingAnnual = (end: string, preferred: string) =>
    pick(
      rv.filter(
        (x) =>
          x.end === end &&
          x.start &&
          days(x.start, x.end) >= 350 &&
          days(x.start, x.end) <= 380 &&
          /^10-K(\/A)?$/.test(x.form),
      ),
      preferred,
    );
  if (revenueValid && tag) {
    if (legs.length === 1) {
      const p = precedingAnnual(
        shiftFinancialDate(ocf.start, -1),
        String(legs[0].accn),
      );
      if (p) prior = valueFact(p, tag);
    } else {
      const fy = precedingAnnual(
        shiftFinancialDate(String(legs[0].start), -1),
        String(legs[0].accn),
      );
      if (fy) {
        const now = rv
          .filter(
            (x) =>
              x.start === legs[2].start &&
              x.end === legs[2].end &&
              x.val === currentLegs[2]!.val,
          )
          .sort((a, b) => b.filed.localeCompare(a.filed));
        for (const n of now) {
          const p = pick(
            rv.filter(
              (x) =>
                x.accn === n.accn &&
                x.start === fy.start &&
                Math.abs(days(x.end, n.end) - 365) <= 8 &&
                Math.abs(days(x.start!, x.end) - days(n.start!, n.end)) <= 8,
            ),
          );
          if (!p) continue;
          prior = {
            value: fy.val + n.val - p.val,
            start: shiftFinancialDate(p.end, 1),
            end: n.end,
            concept: `us-gaap:${tag}`,
            items: [fy, n, p].map((x, i) => ({
              ...serialize(x, tag),
              coefficient: i === 2 ? -1 : 1,
            })),
            calculation: '上期完整财年 + 上期累计 − 对应更早累计',
          };
          break;
        }
      }
    }
  }
  if (
    prior.value !== null &&
    (!validFinancialDate(prior.start) ||
      prior.value < 0 ||
      Math.abs(days(prior.start, prior.end) - days(ocf.start, ocf.end)) > 8 ||
      prior.end !== shiftFinancialDate(ocf.start, -1))
  )
    prior = missingFact(prior.end, '上期营收期间不连续或口径不兼容');
  result.operatingCash.priorRevenue = prior;
  if (revenueValid && prior.value !== null) {
    result.operatingCash.increment =
      (revenue.value! - prior.value) * OPERATING_CASH_REVENUE_RATIO;
    result.operatingCash.formula = `(${revenue.value} − ${prior.value}) × 2% = ${result.operatingCash.increment} USD`;
  } else
    result.operatingCash.reason = revenueValid
      ? (prior.reason ?? '上期营收缺失')
      : '本期营收与OCF申报来源、期间或金额不匹配';
  const included = result.items.filter((x) => x.status === 'INCLUDED'),
    conflicts = result.items.some((x) => x.status === 'CONFLICT');
  if (included.length)
    result.identifiedCashImpact = included.reduce(
      (n, x) => n + x.cashImpact!,
      0,
    );
  const hasAssets = included.some(
    (x) => RULES.find((r) => r.category === x.category)?.sign === -1,
  );
  const hasFunding = included.some(
    (x) => RULES.find((r) => r.category === x.category)?.sign === 1,
  );
  if (
    !conflicts &&
    hasAssets &&
    hasFunding &&
    result.identifiedCashImpact !== null &&
    result.operatingCash.increment !== null
  )
    result.partialValue =
      -result.identifiedCashImpact + result.operatingCash.increment;
  result.status = conflicts
    ? 'CONFLICT'
    : included.length
      ? 'PARTIAL'
      : 'MISSING';
  const assessment = options.coverage,
    accessions = [...new Set(legs.map((x) => String(x.accn)))].sort();
  const assessed =
    assessment &&
    assessment.cik === cik &&
    assessment.start === ocf.start &&
    assessment.end === ocf.end &&
    assessment.evidence.trim() &&
    JSON.stringify([...new Set(assessment.accessions)].sort()) ===
      JSON.stringify(accessions);
  if (assessed && !conflicts && result.partialValue !== null) {
    const unresolved = result.items.filter((x) =>
      ['MISSING', 'UNRESOLVED'].includes(x.status),
    );
    const covered = unresolved.every((item) =>
      assessment.omissions.some(
        (o) =>
          o.category === item.category &&
          o.evidence.trim() &&
          (assessment.status === 'REPRESENTATIVE'
            ? o.treatment === 'IMMATERIAL' ||
              (item.status === 'MISSING' &&
                item.sources.length === 0 &&
                o.treatment === 'NOT_APPLICABLE')
            : item.status === 'MISSING' &&
              item.sources.length === 0 &&
              o.treatment === 'NOT_APPLICABLE'),
      ),
    );
    if (covered) {
      result.coverageAssessment = assessment;
      if (assessment.status === 'COMPLETE') {
        for (const item of unresolved) {
          item.status = 'NOT_APPLICABLE';
          item.reason = assessment.omissions.find(
            (o) => o.category === item.category,
          )!.evidence;
        }
        result.completeValue = result.partialValue;
        result.status = 'COMPLETE';
      } else {
        result.approximateValue = result.partialValue;
        result.status = 'APPROXIMATE';
      }
      result.defaultValue = result.partialValue;
      result.requiresUserAdjustment = false;
      result.warnings.push(`范围核查依据：${assessment.evidence}`);
    }
  }
  // A deliberately narrow same-scope balance check, never an NWC substitute.
  // Each endpoint uses one accession; capital/FX/acquisition effects are NOT forced into cash flow.
  const balanceSources: Record<string, unknown>[] = [],
    balanceValues: number[] = [];
  for (const end of [shiftFinancialDate(ocf.start, -1), ocf.end]) {
    const ars = observations('AccountsReceivableNetCurrent', true).filter(
      (x) => x.end === end,
    );
    const aps = observations('AccountsPayableCurrent', true).filter(
      (x) => x.end === end,
    );
    const preferred =
      end === ocf.end ? String(legs.at(-1)!.accn) : String(legs[0].accn);
    const pairs = ars
      .flatMap((ar) => {
        const ap = pick(aps.filter((x) => x.accn === ar.accn));
        return ap ? [{ ar, ap }] : [];
      })
      .sort(
        (a, b) =>
          Number(b.ar.accn === preferred) - Number(a.ar.accn === preferred) ||
          b.ar.filed.localeCompare(a.ar.filed),
      );
    const selected = pairs[0];
    if (
      !selected ||
      ars.some((x) => x.accn === selected.ar.accn && x.val !== selected.ar.val)
    ) {
      balanceValues.length = 0;
      break;
    }
    balanceValues.push(selected.ar.val - selected.ap.val);
    balanceSources.push(
      serialize(selected.ar, 'AccountsReceivableNetCurrent'),
      serialize(selected.ap, 'AccountsPayableCurrent'),
    );
  }
  const ar = result.items.find((x) => x.category === 'receivables')!,
    ap = result.items.find((x) => x.category === 'payables')!;
  const change =
    balanceValues.length === 2 ? balanceValues[1] - balanceValues[0] : null;
  const comparable =
    ar.status === 'INCLUDED' && ap.status === 'INCLUDED'
      ? -ar.cashImpact! - ap.cashImpact!
      : null;
  result.balanceSheetCheck = {
    scope: '仅应收账款减应付账款的余额变化，不是完整经营NWC',
    change,
    comparableCashFlowChange: comparable,
    difference:
      change !== null && comparable !== null ? change - comparable : null,
    sources: balanceSources,
    reason:
      '余额变化可能包含汇率、收购、非现金及重分类；缺少独立应付数据时不以应计合计替代。',
  };
  result.calculation =
    result.identifiedCashImpact === null
      ? '缺少可合计的经营分项'
      : result.partialValue === null
        ? `仅有已识别现金影响小计 ${result.identifiedCashImpact} USD；净投入条件不足，必要现金增量另列。`
        : `${result.status === 'COMPLETE' ? '完整ΔNWC' : result.status === 'APPROXIMATE' ? '近似ΔNWC' : '已识别项目部分参考'}：−(${included.map((x) => `${x.label} ${x.cashImpact}`).join(' + ')}) + ${result.operatingCash.increment} = ${result.partialValue} USD`;
  if (result.partialValue === null)
    result.warnings.push(
      '未同时取得可靠经营资产及经营负债分项，或营收/期间输入不足；不自动生成部分估计值。',
    );
  return result;
}
