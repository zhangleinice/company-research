import type { ValuationFact } from './dcf.js';
import type { EquityBridgeInput, BridgeItem } from './equity-bridge.js';

export const EQUITY_BRIDGE_POLICY = 'equity-bridge-research-v1';
export const researchBridgeLabels = {
  cash: 'Cash and Cash Equivalents · 现金及现金等价物',
  shortInvestments: 'Short-term Investments · 短期投资',
  longInvestments: 'Long-term Investments · 长期投资',
  financingDebt: 'Total Financing Debt · 含融资租赁的融资债务',
  minority: 'Noncontrolling Interest · 少数股东权益',
  preferred: 'Preferred Stock · 优先股',
  otherClaims: 'Other Material Claims · 其他重大索偿',
  shares: 'Applicable Shares · 估值使用股数',
} as const;
export type ResearchBridgeKey = keyof typeof researchBridgeLabels;
export type ResearchTreatment =
  | 'pending'
  | 'reference'
  | 'manual'
  | 'no_adjustment'
  | 'not_applicable'
  | 'conversion';
export interface ResearchAdjustment {
  treatment: ResearchTreatment;
  /** USD millions, except shares in millions; cash can represent required operating cash. */
  value: number | null;
  rationale: string;
}
export type ResearchReferenceKey =
  | ResearchBridgeKey
  | 'shortDebt'
  | 'longDebt'
  | 'plainDebt'
  | 'financeLeases'
  | 'operatingLeases'
  | 'narrowMinority'
  | 'convertiblePreferred'
  | 'lossContingencies'
  | 'taxClaims'
  | 'pensionClaims'
  | 'annualBasicShares'
  | 'annualDilutedShares'
  | 'quarterBasicShares'
  | 'quarterDilutedShares';
export interface ResearchReference extends ValuationFact {
  status: 'VERIFIED' | 'DISCLOSED' | 'MISSING';
  reason: string | null;
}
export interface EquityBridgeReferences {
  version: 1;
  cik: string;
  asOf: string;
  fingerprint: string;
  facts: Record<ResearchReferenceKey, ResearchReference>;
  financingDebtIncludesLeases: boolean | null;
  /** Existing version-2 combined debt disclosures, not an approved total. */
  debtComponents?: Record<string, ResearchReference>;
}
export interface EquityBridgeResearch {
  policyVersion: typeof EQUITY_BRIDGE_POLICY;
  /** Explicit partial research estimate, never an approval of omitted claims. */
  preliminary?: boolean;
  references: EquityBridgeReferences;
  items: Record<ResearchBridgeKey, ResearchAdjustment>;
  cashMode: 'requiredOperating' | 'directExcess';
  preferredMode: 'unresolved' | 'claim' | 'conversion' | 'none';
  conversionShares: number | null;
  conversionCashClaims: number | null;
  sharesSelection: 'current' | 'annualDiluted' | 'quarterDiluted' | 'manual';
  assetsReviewed: boolean;
  claimsReviewed: boolean;
  leasePolicyReviewed: boolean;
  financingDebtScopeReviewed: boolean;
  minorityScopeReviewed: boolean;
  preferredIssuerReviewed: boolean;
  shareScopeReviewed: boolean;
  otherClaimsInForecast: boolean;
  unresolved: string;
}
export function emptyBridgeResearch(
  references: EquityBridgeReferences,
): EquityBridgeResearch {
  return {
    policyVersion: EQUITY_BRIDGE_POLICY,
    references,
    items: Object.fromEntries(
      Object.keys(researchBridgeLabels).map((k) => [
        k,
        { treatment: 'pending', value: null, rationale: '' },
      ]),
    ) as EquityBridgeResearch['items'],
    cashMode: 'requiredOperating',
    preferredMode: 'unresolved',
    conversionShares: null,
    conversionCashClaims: null,
    sharesSelection: 'current',
    assetsReviewed: false,
    claimsReviewed: false,
    leasePolicyReviewed: false,
    financingDebtScopeReviewed: false,
    minorityScopeReviewed: false,
    preferredIssuerReviewed: false,
    shareScopeReviewed: false,
    otherClaimsInForecast: false,
    unresolved: '',
  };
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
/** Translate reviewed granular inputs into the existing bridge, without another EV formula. */
export function prepareResearchBridge(
  r: EquityBridgeResearch,
  legacy: EquityBridgeInput,
) {
  const errors: string[] = [];
  const values = {} as Record<ResearchBridgeKey, number | null>;
  const states = {} as Record<ResearchBridgeKey, string>;
  const f = r.references.facts;
  const partial = r.preliminary === true;
  const omitted: ResearchBridgeKey[] = [];
  if (r.policyVersion !== EQUITY_BRIDGE_POLICY)
    errors.push('股权桥接政策版本不匹配');
  if (
    !['requiredOperating', 'directExcess'].includes(r.cashMode) ||
    !['unresolved', 'claim', 'conversion', 'none'].includes(r.preferredMode) ||
    !['current', 'annualDiluted', 'quarterDiluted', 'manual'].includes(
      r.sharesSelection,
    )
  )
    errors.push('桥接口径选择无效');
  if (legacy.unresolved.trim()) errors.push(legacy.unresolved.trim());
  const referenceFor = (key: ResearchBridgeKey) =>
    key === 'shares'
      ? f[
          r.sharesSelection === 'annualDiluted'
            ? 'annualDilutedShares'
            : r.sharesSelection === 'quarterDiluted'
              ? 'quarterDilutedShares'
              : 'shares'
        ]
      : key === 'minority' && f.minority.value === null
        ? f.narrowMinority
        : key === 'preferred' &&
            (f.preferred.value === null ||
              (f.preferred.value === 0 &&
                (f.convertiblePreferred.value ?? 0) > 0))
          ? f.convertiblePreferred
          : f[key];
  for (const key of Object.keys(researchBridgeLabels) as ResearchBridgeKey[]) {
    const item = r.items[key],
      ref = referenceFor(key),
      label = researchBridgeLabels[key];
    let value: number | null = null;
    if (
      ![
        'pending',
        'reference',
        'manual',
        'no_adjustment',
        'not_applicable',
        'conversion',
      ].includes(item.treatment)
    )
      errors.push(`${label}：处理方式无效`);
    if (item.treatment === 'pending') {
      if (partial && !['financingDebt', 'shares'].includes(key))
        omitted.push(key);
      else
        errors.push(`${label}：${ref.value === null ? '数据缺失' : '待填写'}`);
    } else {
      if (!partial && !item.rationale.trim())
        errors.push(`${label}：请填写调整依据及来源`);
      if (item.treatment === 'reference') {
        if (
          !finite(ref.value) ||
          ref.status === 'MISSING' ||
          (['financingDebt', 'shortInvestments'].includes(key) &&
            ref.status !== 'VERIFIED')
        )
          errors.push(`${label}：没有可采用的核准参考`);
        else value = ref.value / 1e6;
        if (['cash', 'longInvestments', 'otherClaims'].includes(key))
          errors.push(`${label}：需独立估计估值调整，不能自动全额采用`);
      } else if (item.treatment === 'manual') {
        value = item.value;
        if (!finite(value) || value < 0)
          errors.push(`${label}：需非负有效金额`);
      } else if (
        ['no_adjustment', 'not_applicable', 'conversion'].includes(
          item.treatment,
        )
      )
        value = 0;
      const knownPositive =
        key === 'otherClaims'
          ? [f.lossContingencies, f.taxClaims, f.pensionClaims].some(
              (x) => finite(x.value) && x.value > 0,
            )
          : key === 'financingDebt'
            ? [
                f.financingDebt,
                f.plainDebt,
                f.shortDebt,
                f.longDebt,
                f.financeLeases,
                ...Object.values(r.references.debtComponents ?? {}),
              ].some((x) => finite(x.value) && x.value > 0)
            : key === 'minority'
              ? [f.minority, f.narrowMinority].some(
                  (x) => finite(x.value) && x.value > 0,
                )
              : key === 'preferred'
                ? [f.preferred, f.convertiblePreferred].some(
                    (x) => finite(x.value) && x.value > 0,
                  )
                : finite(ref.value) && ref.value > 0;
      if (
        ['financingDebt', 'minority', 'preferred', 'otherClaims'].includes(
          key,
        ) &&
        knownPositive &&
        item.treatment === 'not_applicable'
      )
        errors.push(`${label}：已有披露索偿，不能仅标记不适用`);
      if (
        ['financingDebt', 'minority'].includes(key) &&
        knownPositive &&
        item.treatment === 'no_adjustment'
      )
        errors.push(`${label}：已有索偿需明确经济价值估计，不能直接忽略`);
      if (item.treatment === 'conversion' && key !== 'preferred')
        errors.push(`${label}：不支持转换处理`);
      if (
        key === 'shares' &&
        ['no_adjustment', 'not_applicable'].includes(item.treatment)
      )
        errors.push('股数不能标记无需调整或不适用');
      if (
        key === 'preferred' &&
        item.treatment === 'no_adjustment' &&
        r.preferredMode !== 'conversion' &&
        knownPositive
      )
        errors.push('已披露优先股需处理索偿或转换，不能直接忽略');
    }
    values[key] = value;
    states[key] =
      item.treatment === 'pending'
        ? ref.value === null
          ? '数据缺失'
          : '待确认'
        : item.treatment === 'reference'
          ? ref.status === 'VERIFIED'
            ? '已核准参考（估值近似）'
            : '采用披露参考（估值近似，范围需研究确认）'
          : item.treatment === 'manual'
            ? '用户估计'
            : item.treatment === 'no_adjustment'
              ? '无需调整'
              : item.treatment === 'not_applicable'
                ? '不适用'
                : '转换情景估计';
  }
  if (
    r.sharesSelection === 'manual' &&
    r.items.shares.treatment === 'reference'
  )
    errors.push('手动股数不能冒充财报参考');
  if (
    r.items.minority.treatment === 'reference' &&
    finite(f.minority.value) &&
    finite(f.narrowMinority.value) &&
    f.minority.value < f.narrowMinority.value
  )
    errors.push(
      '少数权益披露范围冲突：总额候选小于较窄范围，需核对后手动研究估计',
    );
  if (r.items.cash.treatment === 'manual' && values.cash !== null) {
    const cash = f.cash.value === null ? null : f.cash.value / 1e6;
    if (cash === null) {
      errors.push('现金余额未核准，无法确认超额现金上限');
      values.cash = null;
    } else if (values.cash < 0 || values.cash > cash)
      errors.push('经营所需现金或超额现金不能超过对应现金余额');
    else if (r.cashMode === 'requiredOperating')
      values.cash = cash - values.cash;
  }
  if (
    values.shortInvestments !== null &&
    f.shortInvestments.value !== null &&
    values.shortInvestments > f.shortInvestments.value / 1e6
  )
    errors.push('短期投资加回额超过对应独立余额，需排除现金或其他资产重复计价');
  if (!partial && !r.assetsReviewed)
    errors.push('请核对现金和投资无重复加回、经营归属及相关收益未包含在FCFF');
  if (!partial && !r.claimsReviewed)
    errors.push('请核对重大索偿与预测现金流、债务及其他调整没有重复扣减');
  if (!partial && !r.leasePolicyReviewed)
    errors.push(
      '请确认经营租赁作为经营成本，不额外扣负债，并接受融资租赁及SBC尚未完全正常化的条件性口径',
    );
  if (!partial && !r.financingDebtScopeReviewed)
    errors.push('请确认融资债务金额包含融资租赁且只扣减一次');
  if (
    r.items.financingDebt.treatment === 'reference' &&
    r.references.financingDebtIncludesLeases !== true
  )
    errors.push('融资债务含租赁范围尚未核准');
  if (!partial && !r.minorityScopeReviewed)
    errors.push('请核对少数权益总范围及可赎回部分，不能重复相加');
  if (!partial && !r.shareScopeReviewed)
    errors.push('请确认多类别股份经济权益、现有奖励及未来SBC成本未重复计量');
  if (
    r.items.otherClaims.treatment === 'no_adjustment' &&
    !r.otherClaimsInForecast
  )
    errors.push('其他索偿无需调整时，须明确已计入预测或其他调整，且无额外扣减');
  const preferredKnown = [f.preferred, f.convertiblePreferred].some(
    (x) => finite(x.value) && x.value > 0,
  );
  if (!partial && r.preferredMode === 'unresolved')
    errors.push('优先股处理方式待确认');
  if (!partial && preferredKnown && !r.preferredIssuerReviewed)
    errors.push('请核对优先股实际发行主体、索偿及转换条款');
  if (preferredKnown && r.preferredMode === 'none')
    errors.push('已有优先股披露，不能选择无适用优先股');
  if (
    r.preferredMode === 'claim' &&
    !(partial && r.items.preferred.treatment === 'pending') &&
    !['reference', 'manual'].includes(r.items.preferred.treatment)
  )
    errors.push('索偿方式须明确优先股扣减金额');
  if (
    r.preferredMode === 'none' &&
    !['not_applicable', 'no_adjustment'].includes(r.items.preferred.treatment)
  )
    errors.push('无适用优先股时需明确确认及依据');
  if (
    preferredKnown &&
    r.sharesSelection !== 'current' &&
    r.sharesSelection !== 'manual'
  )
    errors.push(
      '优先股情景不能直接采用可能已含转换股份的历史稀释股数；请用时点或明确排除转换的手动基数',
    );
  if (
    r.preferredMode === 'claim' &&
    finite(r.conversionShares) &&
    r.conversionShares > 0
  )
    errors.push('优先股已按索偿扣减，不能再次加入同一转换股份');
  if (r.preferredMode === 'conversion') {
    if (r.items.preferred.treatment !== 'conversion' || values.preferred !== 0)
      errors.push('转换情景不得再次全额扣减同一优先股索偿');
    if (
      !finite(r.conversionShares) ||
      r.conversionShares <= 0 ||
      !finite(r.conversionCashClaims) ||
      r.conversionCashClaims < 0
    )
      errors.push(
        '转换情景需明确新增股份及转换前股息／剩余索偿现值（可明确为0）',
      );
    if (!r.preferredIssuerReviewed) errors.push('转换情景需核对发行主体及条款');
    if (finite(values.shares) && finite(r.conversionShares))
      values.shares += r.conversionShares;
    values.preferred = r.conversionCashClaims;
  }
  if (!finite(values.shares) || values.shares <= 0)
    errors.push('估值使用股数必须大于0');
  if (r.unresolved.trim())
    errors.push(`重大未解决事项：${r.unresolved.trim()}`);
  const item = (value: number | null, key: ResearchBridgeKey): BridgeItem => ({
    value: value === null && partial && omitted.includes(key) ? 0 : value,
    method: 'estimate',
    reportedValue: null,
    source: `CIK ${r.references.cik}；${r.references.asOf}；参考 ${r.references.fingerprint}`,
    rationale:
      r.items[key].rationale ||
      (partial
        ? omitted.includes(key)
          ? '初步估值中明确未纳入，不是已核准零余额'
          : '页面直接输入的可修改研究假设'
        : ''),
    zeroConfirmed: value === 0 || (partial && omitted.includes(key)),
  });
  const bridge: EquityBridgeInput = {
    ...legacy,
    research: undefined,
    items: {
      excessCash: item(
        (finite(values.cash) || (partial && omitted.includes('cash'))) &&
          (finite(values.shortInvestments) ||
            (partial && omitted.includes('shortInvestments')))
          ? (values.cash ?? 0) + (values.shortInvestments ?? 0)
          : null,
        'cash',
      ),
      otherAssets: item(values.longInvestments, 'longInvestments'),
      debt: item(values.financingDebt, 'financingDebt'),
      leases: {
        ...item(0, 'financingDebt'),
        rationale:
          '融资租赁已含融资债务；经营租赁在FCFF作为经营成本，不重复扣减',
      },
      minority: item(values.minority, 'minority'),
      preferred: item(values.preferred, 'preferred'),
      otherClaims: item(values.otherClaims, 'otherClaims'),
      shares: item(values.shares, 'shares'),
    },
    sharesBasis: 'valuationDiluted',
    leaseTreatment: 'inDebt',
    assetsOverlapReviewed: partial || r.assetsReviewed,
    claimsReviewed: partial || r.claimsReviewed,
    unresolved: r.unresolved,
  };
  return {
    bridge,
    errors,
    values,
    states,
    omitted,
    warnings: [
      ...(partial
        ? [
            '初步估值参考：默认金额属于可修改的研究假设，未核准经营归属、经济价值及全部索偿。',
            ...omitted.map(
              (k) => `未纳入：${researchBridgeLabels[k]}（未按真实零值处理）`,
            ),
          ]
        : []),
      '本结果为条件性研究估值：账面债务仅为经济价值近似；现有FCFF未完整正常化融资租赁、非经营现金流及SBC。',
      '历史平均稀释股数不等于当前完全稀释股数；普通股数量与未来转换及奖励范围需独立判断。',
    ],
  };
}
