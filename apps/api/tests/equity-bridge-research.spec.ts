import {
  calculateDcf,
  emptyBridgeResearch,
  emptyEquityBridge,
  evaluateEquityBridge,
  type EquityBridgeReferences,
  type ResearchReferenceKey,
  type EquityBridgeResearch,
  type DcfInput,
} from '@company-research/shared';

function sample(): EquityBridgeResearch {
  const keys: ResearchReferenceKey[] = [
    'cash',
    'shortInvestments',
    'longInvestments',
    'financingDebt',
    'minority',
    'preferred',
    'otherClaims',
    'shares',
    'shortDebt',
    'longDebt',
    'plainDebt',
    'financeLeases',
    'operatingLeases',
    'narrowMinority',
    'convertiblePreferred',
    'lossContingencies',
    'taxClaims',
    'pensionClaims',
    'annualBasicShares',
    'annualDilutedShares',
    'quarterBasicShares',
    'quarterDilutedShares',
  ];
  const refs: EquityBridgeReferences = {
    version: 1,
    cik: '0000000001',
    asOf: '2026-09-30',
    fingerprint: 'test-snapshot',
    financingDebtIncludesLeases: true,
    facts: Object.fromEntries(
      keys.map((key) => [
        key,
        {
          value: 0,
          start: null,
          end: '2026-09-30',
          concept: 'us-gaap:Test',
          items: [],
          status: 'VERIFIED',
          reason: null,
        },
      ]),
    ) as unknown as EquityBridgeReferences['facts'],
  };
  for (const [key, value] of Object.entries({
    cash: 100,
    shortInvestments: 20,
    longInvestments: 30,
    financingDebt: 50,
    financeLeases: 10,
    operatingLeases: 40,
    minority: 3,
    narrowMinority: 1,
    shares: 10,
    annualDilutedShares: 11,
  }))
    refs.facts[key as ResearchReferenceKey].value = value * 1e6;
  const r = emptyBridgeResearch(refs);
  for (const item of Object.values(r.items))
    Object.assign(item, {
      treatment: 'manual',
      value: 0,
      rationale:
        'Explicit synthetic test assumption and source, never persisted',
    });
  r.items.cash.value = 20;
  r.items.shortInvestments.treatment = 'reference';
  r.items.longInvestments.value = 10;
  r.items.financingDebt.treatment = 'reference';
  r.items.minority.treatment = 'reference';
  r.items.preferred.treatment = 'not_applicable';
  r.items.otherClaims.value = 2;
  r.items.shares.treatment = 'reference';
  r.preferredMode = 'none';
  r.assetsReviewed =
    r.claimsReviewed =
    r.leasePolicyReviewed =
    r.financingDebtScopeReviewed =
    r.minorityScopeReviewed =
    r.shareScopeReviewed =
      true;
  return r;
}
function model(r: EquityBridgeResearch): DcfInput {
  return {
    mode: 'simple',
    revenue: null,
    historicalFcff: 100,
    historicalVerified: true,
    years: Array.from({ length: 5 }, () => ({
      growth: 0,
      margin: null,
      tax: null,
      da: null,
      capex: null,
      deltaNwc: null,
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
    nonOperatingAssets: null,
    debt: null,
    otherClaims: null,
    dilutedShares: null,
    assumptions: 'Synthetic only',
    applicable: true,
    bridge: { ...emptyEquityBridge(), research: r },
  };
}
it('reuses the existing bridge and DCF formula, units, and precision; updates equity live without changing EV', () => {
  const r = sample(),
    first = calculateDcf(model(r));
  expect(first.status).toBe('COMPLETE');
  expect(first.equity).toBeCloseTo(first.ev! + 55);
  expect(first.perShare).toBeCloseTo(first.equity! / 10);
  r.items.otherClaims.value = 2.123456789;
  const next = calculateDcf(model(r));
  expect(next.ev).toBe(first.ev);
  expect(next.rows).toEqual(first.rows);
  expect(next.equity).toBeCloseTo(first.equity! - 0.123456789, 8);
});
it('cash and securities stay separate, cash is capped, and duplicate income/assets require explicit review', () => {
  const r = sample();
  const out = evaluateEquityBridge(model(r).bridge!);
  expect(out.nonOperatingAssets).toBe(110);
  expect(out.research?.values.cash).toBe(80);
  r.items.cash.value = 101;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.cashMode = 'directExcess';
  r.items.cash.value = 10;
  expect(evaluateEquityBridge(model(r).bridge!).research?.values.cash).toBe(10);
  r.items.shortInvestments.treatment = 'manual';
  r.items.shortInvestments.value = 21;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.items.shortInvestments.value = 20;
  r.assetsReviewed = false;
  expect(calculateDcf(model(r)).perShare).toBeNull();
});
it('does not deduct finance leases a second time or capitalize operating leases while retaining their costs', () => {
  const r = sample(),
    out = evaluateEquityBridge(model(r).bridge!);
  expect(out.debt).toBe(50);
  expect(out.input.research?.references.facts.financeLeases.value).toBe(10e6);
  r.leasePolicyReviewed = false;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.leasePolicyReviewed = true;
  r.financingDebtScopeReviewed = false;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.financingDebtScopeReviewed = true;
  r.references.financingDebtIncludesLeases = null;
  expect(calculateDcf(model(r)).perShare).toBeNull();
});
it('uses one NCI scope, never total plus subset, and rejects ignoring a disclosed claim', () => {
  const r = sample();
  expect(evaluateEquityBridge(model(r).bridge!).research?.values.minority).toBe(
    3,
  );
  r.items.minority.treatment = 'not_applicable';
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.items.minority.treatment = 'reference';
  r.minorityScopeReviewed = false;
  expect(calculateDcf(model(r)).perShare).toBeNull();
});
it('keeps preferred claim and conversion paths mutually exclusive, including historical dilution', () => {
  const r = sample();
  r.references.facts.convertiblePreferred.value = 5e6;
  r.references.facts.preferred.value = null;
  r.preferredMode = 'claim';
  r.items.preferred.treatment = 'reference';
  r.preferredIssuerReviewed = true;
  expect(calculateDcf(model(r)).perShare).not.toBeNull();
  r.references.facts.preferred.value = 0;
  expect(
    evaluateEquityBridge(model(r).bridge!).research?.values.preferred,
  ).toBe(5);
  r.conversionShares = 1;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.preferredMode = 'conversion';
  r.items.preferred.treatment = 'conversion';
  r.conversionCashClaims = 0.5;
  const out = evaluateEquityBridge(model(r).bridge!);
  expect(out.dilutedShares).toBe(11);
  expect(out.research?.values.preferred).toBe(0.5);
  expect(calculateDcf(model(r)).perShare).toBeCloseTo(
    calculateDcf(model(r)).equity! / 11,
  );
  r.items.preferred.treatment = 'manual';
  r.items.preferred.value = 5;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.items.preferred.treatment = 'conversion';
  r.sharesSelection = 'annualDiluted';
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.sharesSelection = 'current';
  r.preferredMode = 'none';
  r.items.preferred.treatment = 'not_applicable';
  expect(calculateDcf(model(r)).perShare).toBeNull();
});
it('preserves explicit zero versus missing; known other claims cannot become N/A and need overlap resolution', () => {
  const r = sample();
  r.items.otherClaims.value = 0;
  expect(calculateDcf(model(r)).perShare).not.toBeNull();
  r.items.otherClaims.value = null;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.references.facts.taxClaims.value = 9e6;
  r.items.otherClaims.treatment = 'not_applicable';
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.items.otherClaims.treatment = 'no_adjustment';
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.otherClaimsInForecast = true;
  expect(calculateDcf(model(r)).perShare).not.toBeNull();
  r.unresolved = 'Unquantified material lawsuit';
  expect(calculateDcf(model(r)).perShare).toBeNull();
});
it('unknown financing debt cannot be adopted as a fact, but sourced manual conditional estimates remain possible', () => {
  const r = sample();
  r.references.facts.financingDebt.value = null;
  r.references.facts.financingDebt.status = 'MISSING';
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.references.debtComponents = {
    combined: {
      ...r.references.facts.financingDebt,
      value: 40e6,
      status: 'VERIFIED',
    },
  };
  r.items.financingDebt.treatment = 'not_applicable';
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.items.financingDebt.treatment = 'manual';
  r.items.financingDebt.value = 50;
  expect(calculateDcf(model(r)).perShare).not.toBeNull();
  r.items.financingDebt.rationale = '';
  expect(calculateDcf(model(r)).perShare).toBeNull();
});
it('invalid shares and pending items block output; negative equity is retained without a price assertion', () => {
  const r = sample();
  r.sharesSelection = 'manual';
  r.items.shares.treatment = 'manual';
  r.items.shares.value = 0;
  expect(calculateDcf(model(r)).perShare).toBeNull();
  r.items.shares.value = 10;
  r.items.financingDebt.treatment = 'manual';
  r.items.financingDebt.value = 1e9;
  const out = calculateDcf(model(r));
  expect(out.equity).toBeLessThan(0);
  expect(out.perShare).toBeNull();
  expect(out.ev).not.toBeNull();
  r.items.cash.treatment = 'pending';
  expect(calculateDcf(model(r)).equity).toBeNull();
});
