import {
  emptyEquityBridge,
  type DcfInput,
  type EquityBridgeInput,
  type ValuationBaseline,
  type ValuationReferences,
} from '@company-research/shared';
/** Legacy explicit scenario for compatibility; runtime defaults come from simple-valuation policies. */
export const initialScenario = { growth: 5, wacc: 10, terminalGrowth: 3 };
export function referenceBridge(
  refs: ValuationReferences,
  ticker: string,
): EquityBridgeInput {
  const b = emptyEquityBridge();
  const source = `${ticker} SEC财务缓存；期末${refs.periodEnd ?? '未知'}；原始来源见数据来源`;
  if (refs.debt !== null)
    b.items.debt = {
      value: refs.debt / 1e6,
      reportedValue: refs.debt / 1e6,
      method: 'estimate',
      source,
      rationale: '账面有息债务估值近似；租赁及其他索偿需另行确认',
      zeroConfirmed: false,
    };
  if (refs.shares !== null)
    b.items.shares = {
      value: refs.shares / 1e6,
      reportedValue: refs.shares / 1e6,
      method: 'estimate',
      source,
      rationale:
        refs.sharesBasis === 'weightedDiluted'
          ? '历史加权平均稀释股数作估值近似，不是当前完全稀释股数'
          : '时点普通股作估值近似，不包含额外稀释',
      zeroConfirmed: false,
    };
  b.sharesBasis = refs.sharesBasis;
  return b;
}
export function calculatorInput(
  baseline: ValuationBaseline,
  params: {
    growth: number | null;
    wacc: number | null;
    terminalGrowth: number | null;
    useResearch?: boolean;
    researchValue: number | null;
    researchReason: string;
    bridge: EquityBridgeInput;
  },
): DcfInput {
  const basis = fcffBasis(baseline, params);
  return {
    mode: 'simple',
    revenue: null,
    historicalFcff: basis.kind === 'VERIFIED' ? basis.value : null,
    historicalVerified: basis.kind === 'VERIFIED',
    researchFcff: {
      value: basis.kind === 'VERIFIED' ? null : basis.value,
      rationale: basis.reason,
      confirmed: basis.value !== null && basis.value > 0,
    },
    years: Array.from({ length: 5 }, () => ({
      growth: params.growth === null ? null : params.growth / 100,
      margin: null,
      tax: null,
      da: null,
      capex: null,
      deltaNwc: null,
    })),
    wacc: params.wacc === null ? null : params.wacc / 100,
    capital: {
      rf: null,
      beta: null,
      erp: null,
      kd: null,
      tax: null,
      equityWeight: null,
      debtWeight: null,
    },
    g: params.terminalGrowth === null ? null : params.terminalGrowth / 100,
    // Fixed, visible model convention rather than an interactive approval gate.
    stableGrowthConfirmed: true,
    bridge: params.bridge,
    nonOperatingAssets: null,
    debt: null,
    otherClaims: null,
    dilutedShares: null,
    assumptions: `初始情景假设（可修改）：未来5年FCFF增长${params.growth}%，WACC ${params.wacc}%，永续增长${params.terminalGrowth}%；不是SEC预测。${basis.reason}`,
    applicable: baseline.applicable,
  };
}

export function fcffBasis(
  baseline: ValuationBaseline,
  manual: {
    useResearch?: boolean;
    researchValue: number | null;
    researchReason: string;
  },
) {
  if (!manual.useResearch && baseline.fcff !== null)
    return {
      kind: 'VERIFIED' as const,
      value: baseline.fcff / 1e6,
      reason: '已核准历史FCFF',
    };
  if (manual.useResearch)
    return {
      kind: 'MANUAL_RESEARCH' as const,
      value:
        manual.researchValue !== null &&
        manual.researchValue > 0 &&
        manual.researchReason.trim()
          ? manual.researchValue
          : null,
      reason: manual.researchReason,
    };
  const estimate = baseline.fcffEstimate;
  return estimate?.status === 'RESEARCH' && estimate.value !== null
    ? {
        kind: 'AUTO_RESEARCH' as const,
        value: estimate.value / 1e6,
        reason: [estimate.reason, ...estimate.assumptions].join(' '),
      }
    : {
        kind: 'MISSING' as const,
        value: null,
        reason: estimate?.reason ?? '缺少可靠FCFF基准及可用的自动估算条件',
      };
}
