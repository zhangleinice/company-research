import {
  evaluateEquityBridge,
  type EquityBridgeInput,
} from './equity-bridge.js';
/** Money is USD millions; shares are millions; all rates are decimal fractions. */
export interface DcfYear {
  growth: number | null;
  margin: number | null;
  tax: number | null;
  da: number | null;
  capex: number | null;
  deltaNwc: number | null;
}
export interface DcfInput {
  /** Optional for compatibility with V1 callers; the valuation page always supplies it. */
  bridge?: EquityBridgeInput;
  mode: 'simple' | 'detailed';
  revenue: number | null;
  historicalFcff: number | null;
  historicalVerified: boolean;
  /** Explicit conditional research baseline; never upgrades unverified history to SEC fact. */
  researchFcff?: {
    value: number | null;
    rationale: string;
    confirmed: boolean;
  };
  years: DcfYear[];
  wacc: number | null;
  capital: {
    rf: number | null;
    beta: number | null;
    erp: number | null;
    kd: number | null;
    tax: number | null;
    equityWeight: number | null;
    debtWeight: number | null;
  };
  g: number | null;
  stableGrowthConfirmed: boolean;
  nonOperatingAssets: number | null;
  debt: number | null;
  otherClaims: number | null;
  dilutedShares: number | null;
  assumptions: string;
  applicable: boolean;
}
const valid = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
export function historicalFcff(
  fcf: number | null,
  interest: number | null,
  tax: number | null,
  review: {
    interestInOcf: boolean;
    adjustmentsReviewed: boolean;
    taxShieldReviewed: boolean;
  },
) {
  return valid(fcf) &&
    valid(interest) &&
    interest >= 0 &&
    valid(tax) &&
    tax >= 0 &&
    tax <= 1 &&
    review.interestInOcf &&
    review.adjustmentsReviewed &&
    review.taxShieldReviewed
    ? fcf + interest * (1 - tax)
    : null;
}
export function capitalWacc(c: DcfInput['capital']): number | null {
  if (!c || !Object.values(c).every(valid)) return null;
  const {
    rf,
    beta,
    erp,
    kd,
    tax,
    equityWeight: e,
    debtWeight: d,
  } = c as Record<keyof DcfInput['capital'], number>;
  if (
    tax < 0 ||
    tax > 1 ||
    kd < 0 ||
    e < 0 ||
    d < 0 ||
    Math.abs(e + d - 1) > 1e-8
  )
    return null;
  const result = e * (rf + beta * erp) + d * kd * (1 - tax);
  return valid(result) ? result : null;
}
export function calculateDcf(input: DcfInput) {
  const rows: Array<{
    year: number;
    revenue: number | null;
    ebit: number | null;
    fcff: number;
    discount: number;
    pv: number;
  }> = [];
  const forecast: Array<{
    year: number;
    revenue: number | null;
    ebit: number | null;
    fcff: number;
  }> = [];
  const result = {
    status: 'INPUT_REQUIRED' as
      'INPUT_REQUIRED' | 'REVIEW_REQUIRED' | 'NOT_APPLICABLE' | 'COMPLETE',
    errors: [] as string[],
    rows,
    forecast,
    wacc: null as number | null,
    terminalValue: null as number | null,
    terminalPV: null as number | null,
    ev: null as number | null,
    equity: null as number | null,
    perShare: null as number | null,
    assumptions: input?.assumptions ?? '',
    bridge: input?.bridge ? evaluateEquityBridge(input.bridge) : null,
  };
  if (!input || input.applicable !== true) {
    result.status = 'NOT_APPLICABLE';
    result.errors.push('银行、保险等企业不适用普通FCFF模型');
    return result;
  }
  if (typeof input.assumptions !== 'string' || !input.assumptions.trim()) {
    result.errors.push('请记录预测及资本成本假设依据');
    return result;
  }
  if (!Array.isArray(input.years) || input.years.length !== 5) {
    result.errors.push('必须填写五年预测');
    return result;
  }
  const wacc = input.wacc === null ? capitalWacc(input.capital) : input.wacc;
  if (input.mode !== 'simple' && input.mode !== 'detailed') {
    result.errors.push('预测模式无效');
    return result;
  }
  const researchBase = input.researchFcff;
  const verifiedBase =
    input.historicalVerified &&
    valid(input.historicalFcff) &&
    input.historicalFcff > 0;
  const conditionalBase =
    researchBase?.confirmed === true &&
    valid(researchBase.value) &&
    researchBase.value > 0 &&
    Boolean(researchBase.rationale.trim());
  if (input.mode === 'simple' && !verifiedBase && !conditionalBase) {
    result.status = 'NOT_APPLICABLE';
    result.errors.push(
      '简单预测需要已核准的正历史FCFF，或明确确认且有依据的正研究性FCFF基准',
    );
    return result;
  }
  if (
    input.mode === 'detailed' &&
    (!valid(input.revenue) || input.revenue <= 0)
  ) {
    result.errors.push('需要正的历史收入基准');
    return result;
  }
  let revenue = input.revenue,
    fcff = verifiedBase
      ? input.historicalFcff
      : conditionalBase
        ? researchBase!.value
        : null;
  for (const [i, y] of input.years.entries()) {
    if (!y || !valid(y.growth) || y.growth <= -1) {
      result.errors.push(`第${i + 1}年增长率缺失或无效`);
      return result;
    }
    let ebit: number | null = null;
    if (input.mode === 'simple') fcff = fcff! * (1 + y.growth);
    else {
      if (
        ![y.margin, y.tax, y.da, y.capex, y.deltaNwc].every(valid) ||
        y.tax! < 0 ||
        y.tax! > 1 ||
        y.da! < 0 ||
        y.capex! < 0
      ) {
        result.errors.push(
          `第${i + 1}年必须显式填写利润率、税率、D&A、CapEx比例及ΔNWC`,
        );
        return result;
      }
      revenue = revenue! * (1 + y.growth);
      ebit = revenue * y.margin!;
      fcff =
        ebit * (1 - y.tax!) +
        revenue * y.da! -
        revenue * y.capex! -
        y.deltaNwc!;
    }
    if (!valid(fcff)) {
      result.errors.push('预测超出可计算范围');
      return result;
    }
    forecast.push({
      year: i + 1,
      revenue: input.mode === 'detailed' ? revenue : null,
      ebit,
      fcff,
    });
  }
  // Forecasts remain available even when discounting/terminal assumptions are missing.
  if (!valid(wacc) || wacc <= 0 || wacc >= 1) {
    result.errors.push('需有效WACC（大于0且小于100%），暂不能折现及计算EV');
    return result;
  }
  result.wacc = wacc;
  for (const year of forecast) {
    const discount = 1 / Math.pow(1 + wacc, year.year),
      pv = year.fcff * discount;
    if (!valid(pv) || !valid(discount)) {
      result.errors.push('预测超出可计算范围');
      return result;
    }
    rows.push({ ...year, discount, pv });
  }

  if (!valid(input.g) || input.g <= -1 || wacc <= input.g) {
    result.errors.push('永续增长率须大于−100%且小于WACC');
    return result;
  }
  if (!input.stableGrowthConfirmed) {
    result.status = 'REVIEW_REQUIRED';
    result.errors.push('需确认预测期末已达到稳定增长条件');
    return result;
  }

  if (fcff! <= 0) {
    result.status = 'NOT_APPLICABLE';
    result.errors.push('预测期末FCFF非正，永续模型不适用');
    return result;
  }
  const tv = (fcff! * (1 + input.g)) / (wacc - input.g),
    tpv = tv / Math.pow(1 + wacc, 5),
    ev = rows.reduce((s, r) => s + r.pv, 0) + tpv;
  if (![tv, tpv, ev].every(valid)) {
    result.errors.push('终值超出可计算范围');
    return result;
  }
  result.terminalValue = tv;
  result.terminalPV = tpv;
  result.ev = ev;
  if (result.bridge) {
    if (result.bridge.status === 'INSUFFICIENT') {
      result.errors.push(...result.bridge.errors);
      return result;
    }
    input = {
      ...input,
      nonOperatingAssets: result.bridge.nonOperatingAssets,
      debt: result.bridge.debt,
      otherClaims: result.bridge.otherClaims,
      dilutedShares: result.bridge.dilutedShares,
    };
  }
  if (
    ![
      input.nonOperatingAssets,
      input.debt,
      input.otherClaims,
      input.dilutedShares,
    ].every(valid) ||
    input.nonOperatingAssets! < 0 ||
    input.debt! < 0 ||
    input.otherClaims! < 0 ||
    input.dilutedShares! <= 0
  ) {
    result.errors.push(
      'EV已计算；每股估值需明确非经营资产、债务、其他索偿及估值用稀释股数（不能以null代零）',
    );
    return result;
  }
  const equity =
    ev + input.nonOperatingAssets! - input.debt! - input.otherClaims!;
  if (!valid(equity)) {
    result.errors.push('股权调整超出可计算范围');
    return result;
  }
  result.equity = equity;
  if (equity <= 0) {
    result.status = 'NOT_APPLICABLE';
    result.errors.push('股权价值非正，不输出每股价值');
    return result;
  }
  result.perShare = equity / input.dilutedShares!;
  if (!valid(result.perShare)) {
    result.perShare = null;
    result.errors.push('股数或每股结果超出可计算范围');
    return result;
  }
  result.status = 'COMPLETE';
  return result;
}
export interface ValuationFact {
  /** Additive provenance for normalized D&A; no change to financial formulas. */
  approximate?: boolean;
  calculation?: string;
  reason?: string | null;
  policyVersion?: string;
  value: number | null;
  start: string | null;
  end: string;
  concept: string | null;
  items: Record<string, unknown>[];
}
export interface ValuationBaseline {
  bridgeDisclosures?: import('./bridge-disclosures.js').BridgeDisclosures;
  quality?: import('./enterprise-quality.js').EnterpriseQuality;
  ticker: string;
  cik: string;
  name: string | null;
  asOf: string;
  checkedAt: string;
  applicable: boolean;
  status: 'REVIEW_REQUIRED' | 'NOT_APPLICABLE';
  warnings: string[];
  revenue: ValuationFact;
  ebit: ValuationFact;
  ocf: ValuationFact;
  capex: ValuationFact;
  fcf: number | null;
  fcff: number | null;
  interest: ValuationFact;
  fcffChecks?: {
    capitalizedInterest: ValuationFact;
    cashInterest: ValuationFact;
    pretax: ValuationFact;
  };
  fcffEstimate?: {
    status: 'RESEARCH' | 'MISSING';
    value: number | null;
    taxRate: number | null;
    reason: string;
    assumptions: string[];
    version: string;
  };
}

/** Read-only financial-cache references, not automatically suitable valuation amounts. */
export interface ValuationReferences {
  equityBridge?: import('./equity-bridge-research.js').EquityBridgeReferences;
  periodEnd: string | null;
  cash: number | null;
  debt: number | null;
  shares: number | null;
  sharesBasis: 'weightedDiluted' | 'currentCommon' | 'unknown';
  sources: Record<string, unknown>;
}
