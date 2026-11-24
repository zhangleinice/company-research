/** Percentage points. Inputs must already belong to the same normalized period. */
export function capexToOperatingCashFlow(
  capex: number | null,
  operatingCashFlow: number | null,
): number | null {
  if (
    capex === null ||
    operatingCashFlow === null ||
    !Number.isFinite(capex) ||
    !Number.isFinite(operatingCashFlow) ||
    capex < 0 ||
    operatingCashFlow <= 0
  )
    return null;
  const result = (capex / operatingCashFlow) * 100;
  return Number.isFinite(result) ? result : null;
}

/** Same normalized annual or independent-quarter row; percentage points,
 * without intermediate rounding. Missing values never imply zero. */
export function cashFlowQualityMetrics(input: {
  fcf: number | null;
  revenue: number | null;
  operatingCashFlow: number | null;
  netIncome: number | null;
}): { fcfMargin: number | null; cashConversionRatio: number | null } {
  const percentage = (numerator: number | null, denominator: number | null) => {
    if (
      numerator === null ||
      denominator === null ||
      !Number.isFinite(numerator) ||
      !Number.isFinite(denominator) ||
      denominator <= 0
    )
      return null;
    const value = (numerator / denominator) * 100;
    return Number.isFinite(value) ? value : null;
  };
  return {
    fcfMargin: percentage(input.fcf, input.revenue),
    cashConversionRatio: percentage(input.operatingCashFlow, input.netIncome),
  };
}
