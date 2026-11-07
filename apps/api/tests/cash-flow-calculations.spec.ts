import { capexToOperatingCashFlow } from '../src/modules/financials/cash-flow-calculations';

describe('CapEx / OCF percentage', () => {
  it('uses percentage points, preserving zero CapEx and ratios above 100%', () => {
    expect(capexToOperatingCashFlow(91447, 164713)).toBeCloseTo(55.51899364);
    expect(capexToOperatingCashFlow(0, 10)).toBe(0);
    expect(capexToOperatingCashFlow(15, 10)).toBe(150);
  });
  it.each([
    [null, 10],
    [10, null],
    [10, 0],
    [10, -1],
    [-1, 10],
    [NaN, 10],
    [10, Infinity],
  ] as [number | null, number | null][])(
    'preserves missing/invalid inputs (%s, %s)',
    (capex, ocf) => {
      expect(capexToOperatingCashFlow(capex, ocf)).toBeNull();
    },
  );
});
