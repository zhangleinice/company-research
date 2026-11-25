import {
  defaultExcessCash,
  defaultShortInvestments,
  defaultLongInvestments,
  defaultMinority,
  defaultPreferred,
  defaultOtherClaims,
  defaultShares,
  equityDefaultEstimates,
  type EquityDefaultContext,
  type EquityBridgeReferences,
  type ResearchReference,
  type ResearchReferenceKey,
} from '@company-research/shared';
const fact = (
  value: number | null,
  concept = 'us-gaap:Test',
): ResearchReference => ({
  value: value === null ? null : value * 1e6,
  start: null,
  end: '2026-09-30',
  concept,
  status: value === null ? 'MISSING' : 'VERIFIED',
  reason: null,
  items: [{ concept, unit: 'USD', accn: '0000000001-26-000001' }],
});
function context(): EquityDefaultContext {
  const keys = [
    'cash',
    'shortInvestments',
    'longInvestments',
    'minority',
    'narrowMinority',
    'preferred',
    'convertiblePreferred',
    'otherClaims',
    'shares',
    'financingDebt',
    'shortDebt',
    'longDebt',
    'plainDebt',
    'financeLeases',
    'operatingLeases',
    'lossContingencies',
    'taxClaims',
    'pensionClaims',
    'annualBasicShares',
    'annualDilutedShares',
    'quarterBasicShares',
    'quarterDilutedShares',
  ] as ResearchReferenceKey[];
  const refs: EquityBridgeReferences = {
    version: 1,
    cik: '0000000001',
    asOf: '2026-09-30',
    fingerprint: 'test',
    financingDebtIncludesLeases: true,
    facts: Object.fromEntries(
      keys.map((k) => [k, fact(null)]),
    ) as EquityBridgeReferences['facts'],
  };
  for (const [key, n] of Object.entries({
    cash: 100,
    shortInvestments: 20,
    longInvestments: 30,
    minority: 5,
    narrowMinority: 2,
    preferred: 0,
    convertiblePreferred: 8,
    shares: 10,
  }))
    refs.facts[key as ResearchReferenceKey] = fact(n);
  refs.facts.shares.concept = 'us-gaap:CommonStockSharesOutstanding';
  refs.facts.shares.items = [
    { concept: 'us-gaap:CommonStockSharesOutstanding', unit: 'shares' },
  ];
  const revenue = { ...fact(1000), start: '2025-10-01' };
  return {
    references: refs,
    baseline: {
      ticker: 'TEST',
      name: null,
      checkedAt: '2026-11-25',
      status: 'REVIEW_REQUIRED',
      warnings: [],
      ebit: fact(100),
      capex: fact(20),
      interest: fact(1),
      fcf: 50e6,
      fcff: null,
      cik: refs.cik,
      asOf: refs.asOf,
      applicable: true,
      revenue,
      ocf: { ...revenue },
    },
    eligibility: {},
  };
}
test('cash defaults use full precision TTM revenue, never equity or annualized quarters', () => {
  const c = context();
  expect(defaultExcessCash(c).value).toBe(80);
  c.baseline!.ocf.start = null;
  expect(defaultExcessCash(c).value).toBe(80);
  c.references.facts.cash = fact(10);
  expect(defaultExcessCash(c).value).toBe(0);
  expect(defaultExcessCash(c).warnings.some((x) => x.includes('超过'))).toBe(
    true,
  );
  c.baseline!.revenue.value = 1000.123456789e6;
  c.references.facts.cash = fact(100);
  expect(defaultExcessCash(c).value).toBe(
    (100e6 - 1000.123456789e6 * 0.02) / 1e6,
  );
  c.baseline!.revenue.start = '2026-07-01';
  expect(defaultExcessCash(c).value).toBeNull();
  c.baseline!.revenue.start = 'invalid';
  expect(defaultExcessCash(c).value).toBeNull();
  c.baseline!.applicable = false;
  expect(defaultExcessCash(c).value).toBeNull();
});
test('short investments require fair value/nonoverlap but FCFF normalization is a warning', () => {
  const c = context();
  expect(defaultShortInvestments(c).value).toBeNull();
  c.eligibility!.shortInvestments = {
    nonOperating: true,
    excludedFromFcff: true,
    distinctFromOtherAdjustments: true,
    fairValue: fact(20),
  };
  expect(defaultShortInvestments(c).value).toBe(20);
  c.eligibility!.shortInvestments.fairValue = fact(21);
  expect(defaultShortInvestments(c).value).toBeNull();
  c.eligibility!.shortInvestments.fairValue = fact(20);
  c.eligibility!.shortInvestments.excludedFromFcff = false;
  expect(defaultShortInvestments(c).value).toBe(20);
  expect(defaultShortInvestments(c).warnings.join()).toContain('重复计价');
  c.eligibility!.shortInvestments.distinctFromOtherAdjustments = false;
  expect(defaultShortInvestments(c).value).toBeNull();
});
test('long investments, minority and preferred independently prefer fair value and support approved book proxies', () => {
  const c = context();
  expect(defaultLongInvestments(c).value).toBeNull();
  expect(defaultMinority(c).value).toBeNull();
  expect(defaultPreferred(c).value).toBeNull();
  c.eligibility!.longInvestments = {
    scopeComplete: true,
    distinctFromOtherAdjustments: true,
    nonOperating: true,
    excludedFromFcff: true,
  };
  c.eligibility!.minority = {
    scopeComplete: true,
    distinctFromOtherAdjustments: true,
  };
  c.eligibility!.preferred = {
    scopeComplete: true,
    distinctFromOtherAdjustments: true,
    issuerConfirmed: true,
  };
  expect(defaultLongInvestments(c).value).toBe(30);
  expect(defaultMinority(c).value).toBe(5);
  expect(defaultPreferred(c).value).toBe(8);
  c.eligibility!.longInvestments.fairValue = fact(35);
  expect(defaultLongInvestments(c).value).toBe(35);
  c.references.facts.narrowMinority = fact(10);
  expect(defaultMinority(c).value).toBeNull();
  c.eligibility!.preferred.issuerConfirmed = false;
  expect(defaultPreferred(c).value).toBeNull();
});
test('claims only sum qualifying incremental payments; unknown liabilities and duplicate identities never become zero or a sum', () => {
  const c = context();
  expect(defaultOtherClaims(c).value).toBeNull();
  c.eligibility!.otherClaims = {
    scopeComplete: true,
    claims: [
      {
        fact: fact(3, 'Litigation'),
        identity: 'litigation',
        incrementalCashPayment: true,
        excludedFromFcff: true,
        distinctFromOtherAdjustments: true,
      },
      {
        fact: fact(2, 'PensionDeficit'),
        identity: 'pension',
        incrementalCashPayment: true,
        excludedFromFcff: true,
        distinctFromOtherAdjustments: true,
      },
    ],
  };
  expect(defaultOtherClaims(c).value).toBe(5);
  c.eligibility!.otherClaims.claims![1].identity = 'litigation';
  expect(defaultOtherClaims(c).value).toBeNull();
  c.eligibility!.otherClaims.claims![1].identity = 'pension';
  c.eligibility!.otherClaims.claims![0].excludedFromFcff = false;
  expect(defaultOtherClaims(c).value).toBeNull();
  c.eligibility!.otherClaims = {
    explicitlyAbsent: true,
    scopeComplete: true,
    absenceEvidence: fact(0, 'ExplicitAbsence'),
  };
  expect(defaultOtherClaims(c).value).toBe(0);
  c.references.facts.taxClaims = fact(7);
  expect(defaultOtherClaims(c).value).toBeNull();
});
test('shares use current actual common shares with provenance, never historical averages or stale fiscal shares', () => {
  const c = context();
  expect(defaultShares(c).value).toBe(10);
  c.references.facts.shares.end = '2025-12-31';
  expect(defaultShares(c).value).toBeNull();
  c.references.facts.shares = {
    ...fact(11),
    concept: 'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding',
  };
  expect(defaultShares(c).value).toBeNull();
  expect(Object.keys(equityDefaultEstimates(c))).toHaveLength(7);
});

const sourced = (
  value: number,
  concept: string,
  accn = '0001652044-26-000084',
) => {
  const f = fact(value, concept);
  f.items = [{ concept, accn, end: f.end, val: f.value, unit: 'USD' }];
  return f;
};
test('cached marketable securities and identified long investment book values fill without FCFF exclusions', () => {
  const c = context();
  c.references.facts.shortInvestments = sourced(
    20,
    'us-gaap:MarketableSecuritiesCurrent',
  );
  c.references.facts.longInvestments = sourced(
    30,
    'us-gaap:OtherLongTermInvestments',
  );
  expect(defaultShortInvestments(c).value).toBe(20);
  expect(defaultLongInvestments(c).value).toBe(30);
  c.references.facts.shortInvestments.end = '2025-09-30';
  c.references.facts.longInvestments.end = '2025-09-30';
  expect(defaultShortInvestments(c).value).toBeNull();
  expect(defaultLongInvestments(c).value).toBeNull();
});
test('audited filing scope adopts NCI total once and issuer preferred book claim without hardcoded amounts', () => {
  const c = context();
  c.references.facts.minority = fact(null);
  c.references.facts.narrowMinority = sourced(
    7.123,
    'us-gaap:NoncontrollingInterestInVariableInterestEntity',
  );
  c.references.facts.preferred = fact(null);
  c.references.facts.convertiblePreferred = sourced(
    18.456,
    'us-gaap:ConvertiblePreferredStockNonredeemableOrRedeemableIssuerOptionValue',
  );
  expect(defaultMinority(c).value).toBe(7.123);
  expect(defaultPreferred(c).value).toBe(18.456);
  expect(defaultMinority(c).warnings.join()).toContain('可赎回');
  c.references.facts.narrowMinority.items[0].accn = 'other-filing';
  c.references.facts.convertiblePreferred.items[0].accn = 'other-filing';
  expect(defaultMinority(c).value).toBeNull();
  expect(defaultPreferred(c).value).toBeNull();
});
test('unknown claims remain missing and true disclosed zero is preserved', () => {
  const c = context();
  c.references.facts.lossContingencies = sourced(
    13,
    'us-gaap:LossContingencyAccrualCarryingValueCurrent',
  );
  c.references.facts.taxClaims = sourced(12, 'us-gaap:UnrecognizedTaxBenefits');
  expect(defaultOtherClaims(c).value).toBeNull();
  c.references.facts.shortInvestments = sourced(
    0,
    'us-gaap:MarketableSecuritiesCurrent',
  );
  expect(defaultShortInvestments(c).value).toBe(0);
});

test('audited scope cannot transfer to conflicting totals or a new reporting period', () => {
  const c = context();
  c.references.facts.minority = fact(10);
  c.references.facts.narrowMinority = sourced(
    7,
    'us-gaap:NoncontrollingInterestInVariableInterestEntity',
  );
  expect(defaultMinority(c).value).toBeNull();
  c.references.facts.minority = fact(null);
  const f = c.references.facts.narrowMinority;
  c.references.asOf = '2026-12-31';
  f.end = c.references.asOf;
  f.items[0].end = c.references.asOf;
  expect(defaultMinority(c).value).toBeNull();
});
