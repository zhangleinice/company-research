/** Percent input (30 means 30%); preserve raw precision until presentation. */
export function targetBuyPrice(
  fairValue: number | null,
  marginPercent: number | null,
): number | null {
  if (
    fairValue === null ||
    !Number.isFinite(fairValue) ||
    fairValue <= 0 ||
    marginPercent === null ||
    !Number.isFinite(marginPercent) ||
    marginPercent < 0 ||
    marginPercent >= 100
  )
    return null;
  const value = fairValue * (1 - marginPercent / 100);
  return Number.isFinite(value) ? value : null;
}
