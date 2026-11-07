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
