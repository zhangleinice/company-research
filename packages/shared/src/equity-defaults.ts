import type { ValuationBaseline } from './dcf.js';
import type {
  EquityBridgeReferences,
  ResearchReference,
  ResearchBridgeKey,
} from './equity-bridge-research.js';

export const EQUITY_DEFAULTS_POLICY = 'equity-defaults-v2';
export const PRELIMINARY_FCFF_NOTICE =
  '当前FCFF尚未完成非经营性收益调整，估值可能存在重复计价，仅作为初步研究参考。';
export type EquityDefaultKey = Exclude<ResearchBridgeKey, 'financingDebt'>;
/** Scope qualifications must come from validated disclosure/normalization, never tag-name guesses. */
export interface DefaultEligibility {
  nonOperating?: boolean;
  excludedFromFcff?: boolean;
  distinctFromOtherAdjustments?: boolean;
  scopeComplete?: boolean;
  issuerConfirmed?: boolean;
  explicitlyAbsent?: boolean;
  absenceEvidence?: ResearchReference;
  fairValue?: ResearchReference;
  evidence?: string;
  claims?: Array<{
    fact: ResearchReference;
    incrementalCashPayment: boolean;
    excludedFromFcff: boolean;
    distinctFromOtherAdjustments: boolean;
    identity: string;
  }>;
}
export interface EquityDefaultContext {
  references: EquityBridgeReferences;
  baseline: ValuationBaseline | null;
  /** Optional validated disclosure evidence; absence is never inferred from missing tags. */
  eligibility?: Partial<Record<EquityDefaultKey, DefaultEligibility>>;
}
export interface EquityDefaultEstimate {
  value: number | null; // USD millions, or million common shares.
  method: string;
  calculation: string;
  reason: string | null;
  warnings: string[];
  sources: ResearchReference[];
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const usable = (f: ResearchReference | undefined): f is ResearchReference =>
  Boolean(f && f.status !== 'MISSING' && finite(f.value) && f.value >= 0);
const estimate = (
  method: string,
  sources: ResearchReference[],
  value: number | null,
  calculation: string,
  reason: string | null = null,
  warnings: string[] = [],
): EquityDefaultEstimate => ({
  method,
  sources,
  value,
  calculation,
  reason,
  warnings,
});
const matching = (c: EquityDefaultContext) =>
  c.baseline?.cik === c.references.cik && c.baseline.asOf === c.references.asOf;
const absent = (
  c: EquityDefaultContext,
  key: EquityDefaultKey,
  facts: ResearchReference[],
  method: string,
) =>
  c.eligibility?.[key]?.explicitlyAbsent === true &&
  c.eligibility[key]?.scopeComplete === true &&
  usable(c.eligibility[key]?.absenceEvidence) &&
  c.eligibility[key]?.absenceEvidence?.value === 0 &&
  c.eligibility[key]?.absenceEvidence?.end === c.references.asOf &&
  Boolean(c.eligibility[key]?.absenceEvidence?.items.length) &&
  !facts.some((f) => usable(f) && f.value! > 0)
    ? estimate(
        method,
        [...facts, c.eligibility![key]!.absenceEvidence!],
        0,
        '明确披露不存在适用项目 = 0；不是缺失补零',
      )
    : null;

/** Qualifications from the completed filing audit, NOT financial amounts.
 * Bound to the precise SEC accession/concept; never propagated to a new period.
 * Other issuers/filings require their own evidence or a complete standard total.
 */
function auditedDisclosureEligibility(
  c: EquityDefaultContext,
  key: 'longInvestments' | 'minority' | 'preferred',
): DefaultEligibility | undefined {
  const f = c.references.facts;
  const fact = key === 'minority' ? f.narrowMinority : f.convertiblePreferred;
  const audited =
    usable(fact) &&
    fact.end === c.references.asOf &&
    fact.end === '2026-09-30' &&
    fact.items.some(
      (item) =>
        item.accn === '0001652044-26-000084' &&
        item.end === fact.end &&
        item.val === fact.value &&
        item.concept === fact.concept &&
        item.unit === 'USD',
    );
  if (
    key === 'minority' &&
    audited &&
    (!usable(f.minority) || f.minority.value === fact.value) &&
    fact.concept === 'us-gaap:NoncontrollingInterestInVariableInterestEntity'
  )
    return {
      scopeComplete: true,
      distinctFromOtherAdjustments: true,
      evidence:
        '该申报少数权益附注明确 Total noncontrolling interests in our consolidated subsidiaries，of which 为可赎回部分；只采用总额，不另加可赎回组成。',
    };
  if (
    key === 'preferred' &&
    audited &&
    (!usable(f.preferred) ||
      f.preferred.value === 0 ||
      f.preferred.value === fact.value) &&
    fact.concept ===
      'us-gaap:ConvertiblePreferredStockNonredeemableOrRedeemableIssuerOptionValue'
  )
    return {
      scopeComplete: true,
      distinctFromOtherAdjustments: true,
      issuerConfirmed: true,
      evidence:
        '该申报权益附注明确 the company issued Series A/B mandatory convertible preferred stock；属于发行人优先股，与债务及少数权益分列，采用索偿扣减。',
    };
  return undefined;
}

export function defaultExcessCash(
  c: EquityDefaultContext,
): EquityDefaultEstimate {
  const method = '营收比例法（TTM Revenue × 2%）',
    cash = c.references.facts.cash,
    b = c.baseline;
  const revenue = b?.revenue;
  const days = revenue?.start
    ? (Date.parse(revenue.end) - Date.parse(revenue.start)) / 86400000
    : 0;
  if (
    !b?.applicable ||
    !matching(c) ||
    !usable(cash) ||
    cash.status !== 'VERIFIED' ||
    cash.end !== c.references.asOf ||
    !revenue ||
    !finite(revenue.value) ||
    revenue.value <= 0 ||
    revenue.end !== b.asOf ||
    !Number.isFinite(days) ||
    days < 350 ||
    days > 380
  )
    return estimate(
      method,
      [cash],
      null,
      'Max(0, Cash − TTM Revenue × 2%)',
      '缺少适用企业、同期核准现金或完整TTM营收；金融企业不自动套用',
    );
  const required = revenue.value * 0.02,
    value = Math.max(0, cash.value! - required) / 1e6;
  return estimate(
    method,
    [cash, { ...revenue, status: 'DISCLOSED', reason: null }],
    value,
    `Max(0, ${cash.value! / 1e6} − ${revenue.value / 1e6} × 2%) = ${value}`,
    null,
    [
      '2%为经验估值假设，不是SEC披露；OCF包含实际经营营运资金变动，现金存量要求不再次从FCFF扣除。',
      ...(required > cash.value!
        ? [
            '经营所需现金估计超过实际现金余额，超额现金按公式为0；不代表不存在流动性需求。',
          ]
        : []),
    ],
  );
}
export function defaultShortInvestments(
  c: EquityDefaultContext,
): EquityDefaultEstimate {
  const method = '非经营性短期有价证券公允价值法',
    f = c.references.facts.shortInvestments,
    e = c.eligibility?.shortInvestments;
  const zero = absent(c, 'shortInvestments', [f], method);
  if (zero) return zero;
  // V2 approval excludes cash equivalents; only explicitly identified marketable
  // securities qualify for the automatic fair-value reference, not generic investments.
  const marketable =
    usable(f) &&
    f.items.some(
      (item) =>
        [
          'us-gaap:MarketableSecuritiesCurrent',
          'us-gaap:AvailableForSaleSecuritiesCurrent',
        ].includes(String(item.concept)) &&
        item.end === f.end &&
        item.val === f.value &&
        item.unit === 'USD' &&
        Boolean(item.accn),
    );
  const fair = e?.fairValue ?? (marketable ? f : undefined);
  if (
    e?.nonOperating === false ||
    e?.distinctFromOtherAdjustments === false ||
    (!e?.nonOperating && !marketable) ||
    (!e?.distinctFromOtherAdjustments && !marketable) ||
    !usable(fair) ||
    fair.end !== c.references.asOf ||
    f.end !== c.references.asOf ||
    f.status !== 'VERIFIED' ||
    !usable(f) ||
    fair.value! > f.value!
  )
    return estimate(
      method,
      [f],
      null,
      '符合条件的独立短期证券公允价值',
      '缺少同期核准的独立有价证券公允价值或资产范围存在冲突；不以缺失补零',
    );
  return estimate(
    method,
    [fair],
    fair.value! / 1e6,
    `${fair.value! / 1e6}（独立短期有价证券公允价值参考）`,
    null,
    [
      PRELIMINARY_FCFF_NOTICE,
      '默认按非经营性证券研究假设处理；如属于经营所需资产，应手动调整。',
    ],
  );
}
function valueClaim(
  c: EquityDefaultContext,
  key: 'longInvestments' | 'minority' | 'preferred',
  book: ResearchReference,
  method: string,
): EquityDefaultEstimate {
  const e = c.eligibility?.[key] ?? auditedDisclosureEligibility(c, key);
  const knownLongBook =
    key === 'longInvestments' &&
    usable(book) &&
    book.concept === 'us-gaap:OtherLongTermInvestments' &&
    book.items.some(
      (item) =>
        item.concept === book.concept &&
        item.end === book.end &&
        item.val === book.value &&
        Boolean(item.accn),
    );
  const zero = absent(
    c,
    key,
    [
      book,
      ...(key === 'preferred'
        ? [
            c.references.facts.preferred,
            c.references.facts.convertiblePreferred,
          ]
        : key === 'minority'
          ? [c.references.facts.narrowMinority]
          : []),
    ],
    method,
  );
  if (zero) return zero;
  if (
    e?.scopeComplete === false ||
    (!e?.scopeComplete && !knownLongBook) ||
    e?.distinctFromOtherAdjustments === false ||
    (!e?.distinctFromOtherAdjustments && !knownLongBook) ||
    (key === 'longInvestments' && e?.nonOperating === false) ||
    (key === 'preferred' && !e?.issuerConfirmed)
  )
    return estimate(
      method,
      [book],
      null,
      '优先采用可靠公允价值，否则使用可靠账面值',
      key === 'longInvestments'
        ? '长期投资资产范围尚未确认，保留手动估计'
        : key === 'minority'
          ? '尚未核准普通与可赎回少数权益的完整范围及包含关系'
          : '尚未结构化核准实际发行主体、索偿性质及与债务/少数权益的重叠关系',
    );
  const fair =
    usable(e?.fairValue) && e.fairValue.end === c.references.asOf
      ? e.fairValue
      : null;
  const f =
    fair ?? (usable(book) && book.end === c.references.asOf ? book : null);
  return f
    ? estimate(
        method,
        [f],
        f.value! / 1e6,
        `${f.value! / 1e6}（${fair ? '公允价值' : '账面价值近似'}）`,
        null,
        [
          ...(fair ? [] : ['账面价值只是经济价值的近似。']),
          ...(key === 'longInvestments'
            ? [
                PRELIMINARY_FCFF_NOTICE,
                '仅采用已披露的长期投资范围作为非经营性资产假设；并非全部长期投资，不默认补齐未覆盖资产。',
              ]
            : []),
          ...(e?.evidence ? [e.evidence] : []),
          ...(key === 'preferred'
            ? ['采用索偿扣减法，适用股数不再包含对应转换股份。']
            : []),
        ],
      )
    : estimate(
        method,
        [book],
        null,
        '公允价值或账面价值',
        '缺少同期可靠金额，不将缺失视为零',
      );
}
export function defaultLongInvestments(c: EquityDefaultContext) {
  return valueClaim(
    c,
    'longInvestments',
    c.references.facts.longInvestments,
    '长期非经营投资：公允价值优先、账面价值近似法',
  );
}
export function defaultMinority(c: EquityDefaultContext) {
  const f = c.references.facts;
  if (
    usable(f.minority) &&
    usable(f.narrowMinority) &&
    f.minority.value! < f.narrowMinority.value!
  )
    return estimate(
      '少数权益：公允价值优先、账面价值近似法',
      [f.minority, f.narrowMinority],
      null,
      '总额与组成核对',
      '少数权益总额候选小于组成候选，范围冲突',
    );
  return valueClaim(
    c,
    'minority',
    usable(f.minority)
      ? f.minority
      : (c.eligibility?.minority ?? auditedDisclosureEligibility(c, 'minority'))
            ?.scopeComplete
        ? f.narrowMinority
        : f.minority,
    '少数权益：公允价值优先、账面价值近似法',
  );
}
export function defaultPreferred(c: EquityDefaultContext) {
  const f = c.references.facts;
  if (
    usable(f.preferred) &&
    usable(f.convertiblePreferred) &&
    f.preferred.value! > 0 &&
    f.preferred.value! < f.convertiblePreferred.value!
  )
    return estimate(
      '优先股：索偿扣减法',
      [f.preferred, f.convertiblePreferred],
      null,
      '总额与转换证券核对',
      '优先股总额候选与可转换组成范围冲突',
    );
  const book =
    usable(f.preferred) &&
    !(
      f.preferred.value === 0 &&
      usable(f.convertiblePreferred) &&
      f.convertiblePreferred.value! > 0
    )
      ? f.preferred
      : f.convertiblePreferred;
  return valueClaim(
    c,
    'preferred',
    book,
    '优先股：公允价值优先、账面价值近似；索偿扣减法',
  );
}
export function defaultOtherClaims(
  c: EquityDefaultContext,
): EquityDefaultEstimate {
  const method = '符合条件的已确认负债账面价值汇总法',
    f = c.references.facts,
    sources = [f.lossContingencies, f.taxClaims, f.pensionClaims],
    e = c.eligibility?.otherClaims;
  const zero = absent(c, 'otherClaims', sources, method);
  if (zero) return zero;
  if (
    !e?.scopeComplete ||
    !e.claims?.length ||
    e.claims.some(
      (x) =>
        !usable(x.fact) ||
        x.fact.end !== c.references.asOf ||
        !x.incrementalCashPayment ||
        !x.excludedFromFcff ||
        !x.distinctFromOtherAdjustments ||
        !x.identity,
    ) ||
    new Set(e.claims.map((x) => x.identity)).size !== e.claims.length ||
    new Set(
      e.claims.map((x) =>
        JSON.stringify([
          x.fact.concept,
          x.fact.end,
          x.fact.value,
          x.fact.items,
        ]),
      ),
    ).size !== e.claims.length
  )
    return estimate(
      method,
      sources,
      null,
      '合计已确认、需额外现金支付且未计入FCFF或其他调整的负债',
      '诉讼/税务披露金额不等于额外现金索偿；养老金缺口及索偿覆盖不完整，不能机械相加或按0处理',
    );
  const amounts = e.claims.map((x) => x.fact.value! / 1e6);
  return estimate(
    method,
    e.claims.map((x) => x.fact),
    amounts.reduce((a, b) => a + b, 0),
    `${amounts.join(' + ')} = ${amounts.reduce((a, b) => a + b, 0)}`,
  );
}
export function defaultShares(c: EquityDefaultContext): EquityDefaultEstimate {
  const method = '最新时点实际普通股数法',
    f = c.references.facts.shares;
  const identified = f.items.some(
    (x) =>
      [
        'us-gaap:CommonStockSharesOutstanding',
        'dei:EntityCommonStockSharesOutstanding',
      ].includes(String(x.concept)) && x.unit === 'shares',
  );
  if (
    !usable(f) ||
    f.value! <= 0 ||
    f.start !== null ||
    f.end !== c.references.asOf ||
    !identified
  )
    return estimate(
      method,
      [f],
      null,
      '最新适用时点实际普通股数 ÷ 1,000,000',
      '缺少可靠最新时点普通股总额或多类别汇总来源；不以历史平均股数替代',
    );
  return estimate(
    method,
    [f],
    f.value! / 1e6,
    `${f.value} ÷ 1,000,000 = ${f.value! / 1e6}`,
    null,
    [
      '当前实际股数尚不代表已完成所有潜在稀释调整；索偿已扣除的优先股不再加入对应转换股份。',
    ],
  );
}
export function equityDefaultEstimates(
  c: EquityDefaultContext,
): Record<EquityDefaultKey, EquityDefaultEstimate> {
  return {
    cash: defaultExcessCash(c),
    shortInvestments: defaultShortInvestments(c),
    longInvestments: defaultLongInvestments(c),
    minority: defaultMinority(c),
    preferred: defaultPreferred(c),
    otherClaims: defaultOtherClaims(c),
    shares: defaultShares(c),
  };
}
