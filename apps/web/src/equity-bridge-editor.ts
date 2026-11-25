import {
  emptyBridgeResearch,
  emptyEquityBridge,
  type EquityBridgeReferences,
  type EquityBridgeResearch,
  type ResearchBridgeKey,
  type ResearchAdjustment,
  type ResearchReferenceKey,
  type EquityDefaultKey,
  type EquityDefaultEstimate,
  EQUITY_DEFAULTS_POLICY,
} from '@company-research/shared';

export function editableBridge(
  references: EquityBridgeReferences,
  draft: { ticker: string; research: EquityBridgeResearch } | null,
  ticker: string,
) {
  const research =
    draft?.ticker === ticker &&
    draft.research.references.cik === references.cik &&
    draft.research.references.fingerprint === references.fingerprint
      ? draft.research
      : referenceBridgeResearch(references);
  return { ...emptyEquityBridge(), research };
}
export function editBridgeItem(
  research: EquityBridgeResearch,
  key: ResearchBridgeKey,
  patch: Partial<ResearchAdjustment>,
): EquityBridgeResearch {
  return {
    ...research,
    items: { ...research.items, [key]: { ...research.items[key], ...patch } },
  };
}
export const bridgeMoney = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

/** Read-only references: financial facts are not automatically economic-value assumptions. */
export function referenceBridgeResearch(
  refs: EquityBridgeReferences,
): EquityBridgeResearch {
  const r = emptyBridgeResearch(refs);
  const debt = refs.facts.financingDebt;
  if (
    debt.status === 'VERIFIED' &&
    debt.value !== null &&
    Number.isFinite(debt.value) &&
    debt.value >= 0 &&
    refs.financingDebtIncludesLeases === true
  ) {
    r.items.financingDebt = {
      treatment: 'reference',
      value: debt.value / 1e6,
      rationale:
        '采用已核准含融资租赁的债务账面金额作为估值参考；租赁不再次扣减。',
    };
    r.financingDebtScopeReviewed = true;
  }
  r.leasePolicyReviewed = true;
  return r;
}
export function setBridgeAmount(
  r: EquityBridgeResearch,
  key: ResearchBridgeKey,
  value: number | null,
) {
  return editBridgeItem(
    key === 'shares' ? { ...r, sharesSelection: 'manual' } : r,
    key,
    {
      treatment: value === null ? 'pending' : 'manual',
      value,
      rationale: '用户直接输入的条件性估值假设，未升级为SEC核准数据。',
    },
  );
}

/** Direct inputs are conditional assumptions under the existing claim/lease policy. */
export function setTableBridgeAmount(
  r: EquityBridgeResearch,
  key: ResearchBridgeKey,
  value: number | null,
) {
  const next = setBridgeAmount(
    {
      ...r,
      cashMode: 'directExcess',
      preferredMode: 'claim',
      conversionShares: null,
      conversionCashClaims: null,
    },
    key,
    value,
  );
  return readyTableResearch(next);
}
function readyTableResearch(next: EquityBridgeResearch) {
  const complete = Object.values(next.items).every(
    (item) =>
      item.treatment !== 'pending' &&
      item.value !== null &&
      Number.isFinite(item.value) &&
      item.value >= 0,
  );
  return { ...next, preliminary: complete };
}
export const usesDefaultEstimate = (
  r: EquityBridgeResearch,
  key: EquityDefaultKey,
) =>
  !r.items[key].rationale || r.items[key].rationale.startsWith('系统默认估计');
export function restoreBridgeDefault(
  r: EquityBridgeResearch,
  key: EquityDefaultKey,
  d: EquityDefaultEstimate,
) {
  const next = editBridgeItem(
    {
      ...r,
      cashMode: 'directExcess',
      preferredMode: 'claim',
      conversionShares: null,
      conversionCashClaims: null,
      ...(key === 'shares' ? { sharesSelection: 'current' as const } : {}),
    },
    key,
    {
      treatment: d.value === null ? 'pending' : 'manual',
      value: d.value,
      rationale: `系统默认估计 ${EQUITY_DEFAULTS_POLICY}；${d.method}；${d.calculation}；${d.reason ?? ''}`,
    },
  );
  return readyTableResearch(next);
}
export function bridgeWithDefaults(
  refs: EquityBridgeReferences,
  draft: { ticker: string; research: EquityBridgeResearch } | null,
  ticker: string,
  defaults: Record<EquityDefaultKey, EquityDefaultEstimate>,
) {
  const bridge = editableBridge(refs, draft, ticker);
  for (const key of Object.keys(defaults) as EquityDefaultKey[])
    if (usesDefaultEstimate(bridge.research, key))
      bridge.research = restoreBridgeDefault(
        bridge.research,
        key,
        defaults[key],
      );
  return bridge;
}

export function visibleBridgeFacts(
  refs: EquityBridgeReferences,
  row: string,
): ResearchReferenceKey[] {
  const valid = (key: ResearchReferenceKey) => {
    const f = refs.facts[key];
    return (
      f.status !== 'MISSING' && f.value !== null && Number.isFinite(f.value)
    );
  };
  if (row === 'financingDebt')
    return refs.facts.financingDebt.status === 'VERIFIED' &&
      refs.financingDebtIncludesLeases === true &&
      valid('financingDebt')
      ? ['financingDebt']
      : [];
  if (row === 'minority')
    return valid('minority')
      ? ['minority']
      : valid('narrowMinority')
        ? ['narrowMinority']
        : [];
  if (row === 'preferred')
    return valid('preferred') &&
      !(
        refs.facts.preferred.value === 0 &&
        valid('convertiblePreferred') &&
        refs.facts.convertiblePreferred.value! > 0
      )
      ? ['preferred']
      : valid('convertiblePreferred')
        ? ['convertiblePreferred']
        : [];
  if (row === 'otherClaims')
    return (
      ['lossContingencies', 'taxClaims', 'pensionClaims'] as const
    ).filter(valid);
  if (row === 'shares') {
    return [
      ...(valid('shares') ? ['shares' as const] : []),
      ...(valid('quarterDilutedShares')
        ? ['quarterDilutedShares' as const]
        : []),
    ];
  }
  return [];
}
