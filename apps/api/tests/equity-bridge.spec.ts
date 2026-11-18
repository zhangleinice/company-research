import {
  calculateDcf,
  emptyEquityBridge,
  evaluateEquityBridge,
  type DcfInput,
  type EquityBridgeInput,
} from '@company-research/shared';
function bridge(): EquityBridgeInput {
  const b = emptyEquityBridge();
  for (const item of Object.values(b.items))
    Object.assign(item, {
      value: 0,
      method: 'manual',
      source: 'Synthetic test assumptions, 2026-11-18',
      rationale: 'Explicit unit-test amount, not an SEC observation',
      zeroConfirmed: true,
    });
  b.items.excessCash.value = 10;
  b.items.otherAssets.value = 5;
  b.items.debt.value = 20;
  b.items.leases.value = 3;
  b.items.minority.value = 2;
  b.items.shares.value = 10;
  b.sharesBasis = 'weightedDiluted';
  b.leaseTreatment = 'deduct';
  b.assetsOverlapReviewed = b.claimsReviewed = true;
  return b;
}
function model(b: EquityBridgeInput): DcfInput {
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
    assumptions: 'Synthetic DCF with explicit bridge',
    applicable: true,
    nonOperatingAssets: 999,
    debt: 999,
    otherClaims: 999,
    dilutedShares: 999,
    bridge: b,
  };
}
it('distinguishes disclosed zero, assumed zero, and missing, requiring explicit zero confirmation', () => {
  const b = bridge();
  b.items.preferred = {
    ...b.items.preferred,
    method: 'reported',
    reportedValue: 0,
  };
  let r = evaluateEquityBridge(b);
  expect(r.states.preferred).toBe('VERIFIED');
  expect(r.states.otherClaims).toBe('ESTIMATED');
  expect(r.status).toBe('RESEARCH');
  b.items.preferred.zeroConfirmed = false;
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
  b.items.preferred.zeroConfirmed = true;
  b.items.preferred.value = null;
  r = evaluateEquityBridge(b);
  expect(r.states.preferred).toBe('MISSING');
  expect(r.otherClaims).toBeNull();
});
it('permits sourced book debt approximations and sums distinct assets and claims in million units', () => {
  const b = bridge();
  b.items.debt.method = 'estimate';
  b.items.debt.reportedValue = 20;
  const r = calculateDcf(model(b));
  expect(r.bridge?.status).toBe('RESEARCH');
  expect(r.bridge?.nonOperatingAssets).toBe(15);
  expect(r.bridge?.debt).toBe(23);
  expect(r.bridge?.otherClaims).toBe(2);
  expect(r.equity).toBeCloseTo(r.ev! + 15 - 23 - 2);
  expect(r.perShare).toBeCloseTo(r.equity! / 10);
});
it('uses lease treatment exactly once and requires asset/claim overlap review', () => {
  const b = bridge();
  expect(evaluateEquityBridge(b).debt).toBe(23);
  b.leaseTreatment = 'inDebt';
  expect(evaluateEquityBridge(b).debt).toBe(20);
  b.leaseTreatment = 'inFcff';
  expect(evaluateEquityBridge(b).debt).toBe(20);
  b.leaseTreatment = 'unknown';
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
  b.leaseTreatment = 'inDebt';
  b.items.leases.value = 21;
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
  b.items.leases.value = 3;
  b.assetsOverlapReviewed = false;
  expect(calculateDcf(model(b)).perShare).toBeNull();
  b.assetsOverlapReviewed = true;
  b.claimsReviewed = false;
  expect(calculateDcf(model(b)).equity).toBeNull();
});
it('blocks material unknowns even if legacy amounts are filled, but preserves forecast EV', () => {
  const b = bridge();
  const initial = calculateDcf(model(b));
  b.unresolved = 'Unquantified material tax claim';
  const blocked = calculateDcf(model(b));
  expect(blocked.ev).toBe(initial.ev);
  expect(blocked.perShare).toBeNull();
  expect(blocked.equity).toBeNull();
  expect(blocked.errors.join()).toContain('Unquantified material tax claim');
  b.unresolved = '';
  b.items.otherClaims.method = 'unknown';
  expect(calculateDcf(model(b)).perShare).toBeNull();
});
it('recalculates claims and share assumptions without changing FCFF or EV', () => {
  const b = bridge(),
    first = calculateDcf(model(b));
  b.items.shares.value = 20;
  const second = calculateDcf(model(b));
  expect(second.perShare).toBeCloseTo(first.perShare! / 2);
  expect(second.ev).toBe(first.ev);
  expect(second.rows).toEqual(first.rows);
  b.items.otherClaims.value = 10;
  expect(calculateDcf(model(b)).equity).toBeCloseTo(first.equity! - 10);
});
it('rejects unsourced estimates, mismatched reported amounts and misleading share basis', () => {
  const b = bridge();
  b.items.debt.source = '';
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
  b.items.debt.source = 'SEC';
  b.items.debt.method = 'reported';
  b.items.debt.reportedValue = 21;
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
  b.items.debt.reportedValue = 20;
  b.items.shares.method = 'reported';
  b.items.shares.reportedValue = 10;
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
  b.sharesBasis = 'valuationDiluted';
  expect(evaluateEquityBridge(b).status).toBe('RESEARCH');
  b.items.shares.value = 0;
  expect(evaluateEquityBridge(b).status).toBe('INSUFFICIENT');
});
