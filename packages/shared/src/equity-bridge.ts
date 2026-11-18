/** Money and shares are both in millions. No financial defaults are supplied. */
export type BridgeMethod = 'reported' | 'estimate' | 'manual' | 'unknown';
export interface BridgeItem {
  value: number | null;
  method: BridgeMethod;
  /** Original disclosed amount, before any valuation haircut/adjustment. */
  reportedValue: number | null;
  source: string;
  rationale: string;
  zeroConfirmed: boolean;
}
export const bridgeLabels = {
  excessCash: '超额现金及短期投资',
  otherAssets: '其他非经营资产',
  debt: '有息债务',
  leases: '租赁索偿',
  minority: '少数股东权益',
  preferred: '优先股',
  otherClaims: '税务及其他索偿',
  shares: '估值用稀释股数',
} as const;
export type BridgeKey = keyof typeof bridgeLabels;
export interface EquityBridgeInput {
  items: Record<BridgeKey, BridgeItem>;
  sharesBasis:
    'unknown' | 'currentCommon' | 'weightedDiluted' | 'valuationDiluted';
  leaseTreatment: 'unknown' | 'deduct' | 'inDebt' | 'inFcff';
  assetsOverlapReviewed: boolean;
  claimsReviewed: boolean;
  /** Each nonblank unresolved material issue blocks equity and per-share output. */
  unresolved: string;
}
export function emptyEquityBridge(): EquityBridgeInput {
  return {
    items: Object.fromEntries(
      Object.keys(bridgeLabels).map((key) => [
        key,
        {
          value: null,
          method: 'unknown',
          reportedValue: null,
          source: '',
          rationale: '',
          zeroConfirmed: false,
        },
      ]),
    ) as EquityBridgeInput['items'],
    sharesBasis: 'unknown',
    leaseTreatment: 'unknown',
    assetsOverlapReviewed: false,
    claimsReviewed: false,
    unresolved: '',
  };
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export function evaluateEquityBridge(input: EquityBridgeInput) {
  const errors: string[] = [];
  const states = {} as Record<BridgeKey, 'VERIFIED' | 'ESTIMATED' | 'MISSING'>;
  for (const key of Object.keys(bridgeLabels) as BridgeKey[]) {
    const item = input.items[key];
    states[key] =
      !item || item.method === 'unknown' || !finite(item.value)
        ? 'MISSING'
        : item.method === 'reported'
          ? 'VERIFIED'
          : 'ESTIMATED';
    if (states[key] === 'MISSING') {
      errors.push(`${bridgeLabels[key]}：暂不确定`);
      continue;
    }
    const priorErrors = errors.length;
    if (
      !['reported', 'estimate', 'manual'].includes(item.method) ||
      item.value! < 0 ||
      (key === 'shares' && item.value! <= 0)
    )
      errors.push(`${bridgeLabels[key]}：金额/股数无效`);
    if (!item.source.trim() || !item.rationale.trim())
      errors.push(`${bridgeLabels[key]}：需来源/日期和估值口径依据`);
    if (
      item.method === 'reported' &&
      (!finite(item.reportedValue) || item.value !== item.reportedValue)
    )
      errors.push(
        `${bridgeLabels[key]}：财报数值必须与原始披露一致，调整值请选择估算`,
      );
    if (item.value === 0 && !item.zeroConfirmed)
      errors.push(`${bridgeLabels[key]}：零值须显式确认，不能由缺失推定`);
    if (
      item.reportedValue !== null &&
      (!finite(item.reportedValue) || item.reportedValue < 0)
    )
      errors.push(`${bridgeLabels[key]}：原始披露值无效`);
    if (errors.length > priorErrors) states[key] = 'MISSING';
  }
  if (
    !['currentCommon', 'weightedDiluted', 'valuationDiluted'].includes(
      input.sharesBasis,
    )
  )
    errors.push('需明确普通股、历史平均稀释股数或预计估值稀释股数的口径');
  if (
    ['currentCommon', 'weightedDiluted'].includes(input.sharesBasis) &&
    input.items.shares?.method === 'reported'
  )
    errors.push(
      '普通股或历史平均稀释股数用于估值时属于近似，请选择估算并说明依据',
    );
  if (!input.assetsOverlapReviewed)
    errors.push('需核对现金、投资及其他资产不重复加回，且相关收益未包含在FCFF');
  if (!input.claimsReviewed)
    errors.push('需核对少数股东、优先股、税务、或有负债及其他重大索偿');
  if (input.unresolved.trim())
    errors.push(`重大未知事项：${input.unresolved.trim()}`);
  if (!['deduct', 'inDebt', 'inFcff'].includes(input.leaseTreatment))
    errors.push('需明确租赁已含于债务、已在FCFF扣除，或需单独扣除');
  if (
    input.leaseTreatment === 'inDebt' &&
    finite(input.items.leases?.value) &&
    finite(input.items.debt?.value) &&
    input.items.leases.value > input.items.debt.value
  )
    errors.push('债务内含租赁不能超过债务合计');
  const complete = errors.length === 0;
  const v = (key: BridgeKey) => input.items[key].value!;
  return {
    status: complete ? ('RESEARCH' as const) : ('INSUFFICIENT' as const),
    states,
    errors,
    // These sums exist only after every component and review is explicit.
    nonOperatingAssets: complete ? v('excessCash') + v('otherAssets') : null,
    debt: complete
      ? v('debt') + (input.leaseTreatment === 'deduct' ? v('leases') : 0)
      : null,
    otherClaims: complete
      ? v('minority') + v('preferred') + v('otherClaims')
      : null,
    dilutedShares: complete ? v('shares') : null,
    input,
  };
}
