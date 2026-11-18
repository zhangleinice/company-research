import {
  calculateDcf,
  capitalWacc,
  historicalFcff,
  type DcfInput,
} from '@company-research/shared';
function input(): DcfInput {
  return {
    mode: 'detailed',
    revenue: 100,
    historicalFcff: null,
    historicalVerified: false,
    years: Array.from({ length: 5 }, () => ({
      growth: 0,
      margin: 0.2,
      tax: 0.25,
      da: 0.05,
      capex: 0.1,
      deltaNwc: 0,
    })),
    wacc: 0.1,
    capital: {
      rf: null,
      beta: null,
      erp: null,
      kd: null,
      tax: null,
      equityWeight: null,
      debtWeight: null,
    },
    g: 0.02,
    stableGrowthConfirmed: true,
    nonOperatingAssets: 10,
    debt: 20,
    otherClaims: 0,
    dilutedShares: 10,
    assumptions:
      'Synthetic: flat revenue, 20% margin; no NWC additions; 10% cost, 2% stable growth. All explicit assumptions.',
    applicable: true,
  };
}
it('calculates CAPM/WACC with a deductible debt tax shield and rejects missing inputs/weights', () => {
  expect(
    capitalWacc({
      rf: 0.04,
      beta: 1.2,
      erp: 0.05,
      kd: 0.05,
      tax: 0.25,
      equityWeight: 0.8,
      debtWeight: 0.2,
    }),
  ).toBeCloseTo(0.0875);
  expect(capitalWacc({ ...input().capital })).toBeNull();
  expect(
    capitalWacc({
      rf: 0.04,
      beta: 1,
      erp: 0.05,
      kd: 0.05,
      tax: 0.2,
      equityWeight: 0.8,
      debtWeight: 0.3,
    }),
  ).toBeNull();
});
it('calculates five cashflows, discounts terminal value once, and bridges EV to per-share value', () => {
  const r = calculateDcf(input());
  expect(r.status).toBe('COMPLETE');
  expect(r.rows.map((y) => y.fcff)).toEqual([10, 10, 10, 10, 10]);
  const expectedTV = (10 * 1.02) / (0.1 - 0.02),
    pv = expectedTV / 1.1 ** 5;
  expect(r.terminalValue).toBeCloseTo(expectedTV);
  expect(r.terminalPV).toBeCloseTo(pv);
  expect(r.ev).toBeCloseTo(
    [1, 2, 3, 4, 5].reduce((s, y) => s + 10 / 1.1 ** y, 0) + pv,
  );
  expect(r.equity).toBeCloseTo(r.ev! - 10);
  expect(r.perShare).toBeCloseTo((r.ev! - 10) / 10);
});
it('never substitutes null NWC or bridge inputs with zero; EV can be separate from incomplete equity', () => {
  const i = input();
  i.years[2].deltaNwc = null;
  expect(calculateDcf(i).ev).toBeNull();
  i.years[2].deltaNwc = 0;
  i.debt = null;
  const r = calculateDcf(i);
  expect(r.ev).not.toBeNull();
  expect(r.equity).toBeNull();
  expect(r.perShare).toBeNull();
});
it.each([0.1, 0.11])('blocks g=%s at/above WACC', (g) => {
  expect(calculateDcf({ ...input(), g }).ev).toBeNull();
});
it('blocks negative terminal FCFF, absent stable-growth review, unsupported financial institutions and unverified simple base', () => {
  const i = input();
  i.years[4].capex = 0.8;
  expect(calculateDcf(i).status).toBe('NOT_APPLICABLE');
  expect(
    calculateDcf({ ...input(), stableGrowthConfirmed: false }).status,
  ).toBe('REVIEW_REQUIRED');
  expect(calculateDcf({ ...input(), applicable: false }).status).toBe(
    'NOT_APPLICABLE',
  );
  expect(
    calculateDcf({
      ...input(),
      mode: 'simple',
      historicalFcff: -1,
      historicalVerified: true,
    }).ev,
  ).toBeNull();
  expect(
    calculateDcf({
      ...input(),
      mode: 'simple',
      historicalFcff: 10,
      historicalVerified: false,
    }).ev,
  ).toBeNull();
});
it('simple and detailed forecasts share one discount engine and recalculate parameters', () => {
  const i = input();
  const a = calculateDcf(i);
  const b = calculateDcf({
    ...i,
    mode: 'simple',
    historicalFcff: 10,
    historicalVerified: true,
  });
  expect(a.ev).toBe(b.ev);
  i.years[0].growth = 0.1;
  expect(calculateDcf(i).ev).not.toBe(a.ev);
});
it('historical approximation requires classification, capitalized/noncash and tax review; zero interest is allowed only explicitly', () => {
  expect(
    historicalFcff(10, 2, 0.25, {
      interestInOcf: true,
      adjustmentsReviewed: true,
      taxShieldReviewed: true,
    }),
  ).toBe(11.5);
  expect(
    historicalFcff(10, 2, 0.25, {
      interestInOcf: true,
      adjustmentsReviewed: false,
      taxShieldReviewed: true,
    }),
  ).toBeNull();
  expect(
    historicalFcff(10, null, 0.25, {
      interestInOcf: true,
      adjustmentsReviewed: true,
      taxShieldReviewed: true,
    }),
  ).toBeNull();
});

it('rejects missing dilution and nonpositive equity even with a valid EV', () => {
  const i = input();
  i.dilutedShares = null;
  expect(calculateDcf(i).perShare).toBeNull();
  i.dilutedShares = 10;
  i.debt = 1e9;
  expect(calculateDcf(i).status).toBe('NOT_APPLICABLE');
  expect(calculateDcf(i).perShare).toBeNull();
});
