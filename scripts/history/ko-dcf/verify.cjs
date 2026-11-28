// KO as-of research only. No database or product mutations.
const fs = require('node:fs'),
  assert = require('node:assert/strict');
const { inspect } = require('../dcf-coverage/verify.cjs');
const { calculateDcf, historicalFcff } = require('@company-research/shared');
const {
  normalizeCompanyFacts,
} = require('../../../apps/api/dist/modules/financials/normalize-company-facts');
const c = inspect('KO', [
  'InterestExpense',
  'InterestPaid',
  'DepreciationDepletionAndAmortization',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
]);
const raw = JSON.parse(
  fs.readFileSync('/tmp/dcf-companyfacts-coverage/KO-facts.json'),
);
const histories = normalizeCompanyFacts(raw)
  .annual.slice(0, 5)
  .reverse()
  .map((r) => ({
    year: r.fiscalYear,
    start: r.periodStart,
    end: r.periodEnd,
    revenue: r.revenue / 1e6,
    ebit: r.operatingIncome / 1e6,
    margin: r.operatingIncome / r.revenue,
    ocf: r.operatingCashFlow / 1e6,
    capex: r.capex / 1e6,
    capexRatio: r.capex / r.revenue,
    fcf: r.fcf / 1e6,
    sources: r.sources,
  }));
const cagr = (histories[4].revenue / histories[0].revenue) ** (1 / 4) - 1;
const m = c.metrics;
const source = (tag, end = c.filing.end, unit = 'USD') => ({
  tag,
  unit,
  observations: (raw.facts['us-gaap'][tag]?.units[unit] || []).filter(
    (f) => f.end === end && f.accn === c.filing.accn,
  ),
});
const financials = {
  filing: c.filing,
  revenue: m.Revenue.calculation,
  ebit: m.EBIT.calculation,
  ocf: m.OCF.calculation,
  capex: m.CapEx.calculation,
  da: m.DA.calculation,
  interest: c.extra.InterestExpense.ttm,
  pretax:
    c.extra
      .IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest
      .ttm,
  tax: m.Tax.calculation,
  fcf: m.OCF.value - m.CapEx.value,
};
const bridgeEvidence = [
  'CashAndCashEquivalentsAtCarryingValue',
  'OtherShortTermInvestments',
  'MarketableSecurities',
  'LongTermDebtAndCapitalLeaseObligationsCurrent',
  'LongTermDebtAndCapitalLeaseObligations',
  'NotesAndLoansPayable',
  'MinorityInterest',
  'RedeemableNoncontrollingInterestEquityCarryingAmount',
  'PreferredStockValue',
  'FinanceLeaseLiability',
  'OperatingLeaseLiabilityCurrent',
  'OperatingLeaseLiabilityNoncurrent',
  'WeightedAverageNumberOfDilutedSharesOutstanding',
].map((tag) =>
  source(tag, undefined, tag.startsWith('Weighted') ? 'shares' : 'USD'),
);
const baseRevenue = m.Revenue.value / 1e6;
const settings = [
  {
    name: '保守',
    growth: [0.03, 0.025, 0.02, 0.02, 0.02],
    margin: 0.26,
    tax: 0.25,
    da: 0.021,
    capex: 0.045,
    nwc: 0.2,
    beta: 0.9,
    kd: 0.055,
    g: 0.02,
  },
  {
    name: '基准',
    growth: [0.05, 0.045, 0.035, 0.025, 0.025],
    margin: 0.295,
    tax: 0.23,
    da: 0.02,
    capex: 0.04,
    nwc: 0.15,
    beta: 0.7,
    kd: 0.05,
    g: 0.025,
  },
  {
    name: '乐观',
    growth: [0.06, 0.05, 0.04, 0.03, 0.03],
    margin: 0.31,
    tax: 0.21,
    da: 0.02,
    capex: 0.04,
    nwc: 0.1,
    beta: 0.5,
    kd: 0.045,
    g: 0.03,
  },
];
const scenarios = settings.map((s) => {
  let previous = baseRevenue;
  const years = s.growth.map((growth) => {
    const revenue = previous * (1 + growth),
      deltaNwc = (revenue - previous) * s.nwc;
    previous = revenue;
    return {
      growth,
      margin: s.margin,
      tax: s.tax,
      da: s.da,
      capex: s.capex,
      deltaNwc,
    };
  });
  const input = {
    mode: 'detailed',
    revenue: baseRevenue,
    historicalFcff: null,
    historicalVerified: false,
    years,
    wacc: null,
    capital: {
      rf: 0.0494,
      beta: s.beta,
      erp: 0.0441,
      kd: s.kd,
      tax: s.tax,
      equityWeight: 0.85,
      debtWeight: 0.15,
    },
    g: s.g,
    stableGrowthConfirmed: true,
    nonOperatingAssets: null,
    debt: null,
    otherClaims: null,
    dilutedShares: null,
    assumptions: `KO scenario only; all growth/margin/reinvestment/beta/Kd/weights/tax are analyst assumptions, NOT SEC forecasts or measured capital structure. Rf/ERP dated Nov1 2026.`,
    applicable: true,
  };
  const result = calculateDcf(input);
  assert.ok(result.ev > 0);
  assert.equal(result.perShare, null);
  const probe = calculateDcf({
    ...input,
    nonOperatingAssets: 10,
    debt: 20,
    otherClaims: 3,
    dilutedShares: 1000,
  });
  assert.equal(probe.status, 'COMPLETE');
  assert.ok(Math.abs(probe.perShare - (result.ev - 13) / 1000) < 1e-10);
  return {
    name: s.name,
    nwcRatio: s.nwc,
    input,
    result,
    syntheticBridgeProbe: {
      nonOperatingAssets: 10,
      debt: 20,
      otherClaims: 3,
      shares: 1000,
      equity: probe.equity,
      perShare: probe.perShare,
      warning: 'arbitrary unit-test bridge; NOT KO balance sheet or valuation',
    },
  };
});
const output = {
  asOf: '2026-11-18',
  units: 'USD millions; shares millions; engine rates decimal',
  financials,
  histories,
  revenueCagr2021to2025: cagr,
  bridgeEvidence,
  commonSharesCoverPage:
    raw.facts.dei?.EntityCommonStockSharesOutstanding?.units.shares.filter(
      (f) => f.accn === c.filing.accn,
    ),
  historicalFcffVerified: null,
  unadjustedFcffEstimate: {
    value: (financials.fcf + financials.interest.value * (1 - 0.23)) / 1e6,
    taxAssumption: 0.23,
    warning:
      'unverified expense/cash timing, marginal shield, nonoperating income, leases; illustrative approximation only',
  },
  ebitCrosscheck: {
    beforeNwc:
      (financials.ebit.value * (1 - 0.23) +
        financials.da.value -
        financials.capex.value) /
      1e6,
    deltaNwc: null,
    fcff: null,
  },
  scenarios,
};
fs.writeFileSync(
  'apps/api/tests/fixtures/financial-evidence/ko-dcf-validation.json',
  JSON.stringify(output, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      cagr,
      scenarios: scenarios.map((s) => ({
        name: s.name,
        wacc: s.result.wacc,
        fcff: s.result.rows.map((r) => r.fcff),
        tv: s.result.terminalValue,
        tvpv: s.result.terminalPV,
        ev: s.result.ev,
        equity: s.result.equity,
        perShare: s.result.perShare,
      })),
      estimate: output.unadjustedFcffEstimate,
    },
    null,
    2,
  ),
);
