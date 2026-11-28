// Offline KO research bridge; never writes the database or supplies app defaults.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { calculateDcf, emptyEquityBridge } = require('@company-research/shared');
const original = JSON.parse(
  fs.readFileSync('apps/api/tests/fixtures/financial-evidence/ko-dcf-validation.json'),
);
const q =
  'https://www.sec.gov/Archives/edgar/data/21344/000162828026067844/ko-20261002.htm';
const k =
  'https://www.sec.gov/Archives/edgar/data/21344/000162828026010047/ko-20251231.htm';
const raw = JSON.parse(
  fs.readFileSync('/tmp/dcf-companyfacts-coverage/KO-facts.json'),
);
function fact(tag, expected) {
  const row = raw.facts['us-gaap'][tag]?.units.USD.find(
    (r) =>
      r.accn === original.financials.filing.accn &&
      r.end === '2026-10-02' &&
      !r.start,
  );
  assert.ok(row, tag);
  assert.equal(row.val / 1e6, expected);
  return { concept: tag, unit: 'USD', ...row, url: q };
}
const evidence = [
  fact('CashAndCashEquivalentsAtCarryingValue', 13454),
  fact('OtherShortTermInvestments', 231),
  fact('MarketableSecurities', 2910),
  fact('EquityMethodInvestments', 20710),
  fact('LongTermDebtAndCapitalLeaseObligationsCurrent', 4923),
  fact('LongTermDebtAndCapitalLeaseObligations', 36623),
  fact('NotesAndLoansPayable', 73),
  fact('MinorityInterest', 2161),
];
const $ = load(fs.readFileSync('/tmp/ko-dcf-validation/annual.html', 'utf8'));
$('script,style').remove();
const text = $('body').text().replace(/\s+/g, ' ');
assert.ok(text.includes('Total operating lease liabilities$1,722'));
assert.ok(
  text.includes(
    'Operating lease expense is recognized on a straight-line basis',
  ),
);
const bridge = emptyEquityBridge();
const set = (key, value, reportedValue, source, rationale) =>
  (bridge.items[key] = {
    value,
    reportedValue,
    source,
    rationale,
    method: 'estimate',
    zeroConfirmed: value === 0,
  });
set(
  'excessCash',
  10685,
  13685,
  `${q} balance sheet 2026-10-02; filed 2026-10-28`,
  'Conditional research assumption: retain 3,000 operating cash (~0.7 month of TTM revenue); add cash+short-term investments 13,685 less buffer. Excludes marketable securities, captive assets and IRS deposit. No claim that all cash is distributable.',
);
set(
  'otherAssets',
  20710,
  20710,
  `${q} balance sheet equity method investments 2026-10-02`,
  'Conditional book-value proxy for equity-method stakes, no market premium. Forecast based on operating EBIT excludes equity-method income; assume no affiliate dividends double counted. Other securities 2,910, insurance investments, IRS deposit and held-for-sale net assets receive no separate addback (deliberate 100% haircut/exclusion, not proven worthless). Strategic operating relationships and disposals remain limitations.',
);
set(
  'debt',
  41619,
  41619,
  `${q} balance sheet 2026-10-02; 73+4,923+36,623`,
  'Conditional book-debt approximation, each current/noncurrent line included once. Do not also subtract disclosed fair-value debt 35,398. Assume material finance-lease claims fall within debt proxy; unallocated financial lease/hedge/held-for-sale financing differences are not independently priced.',
);
set(
  'leases',
  1722,
  1722,
  `${k} operating lease note 2025-12-31; filed 2026-02-20`,
  'Stale disclosed operating lease balance carried as an estimate, not current fact. Keep operating lease costs within forecast operating margin/FCFF and do not subtract lease liability again. No rent addback. Finance leases covered only by conditional debt approximation; no claim of fully verified lease inventory.',
);
set(
  'minority',
  2161,
  2161,
  `${q} consolidated balance sheet 2026-10-02`,
  'Book minority interest used as value proxy because forecast is consolidated; no independently observed market value. Not included again in other claims.',
);
set(
  'preferred',
  0,
  null,
  `${q} consolidated equity and financing review; conditional assumption 2026-11-18`,
  'No preferred line in reviewed consolidated balance sheet; explicit conditional assumption of no material preferred/redemption claim. Not an SEC-disclosed zero and not inferred solely from a missing XBRL tag.',
);
set(
  'otherClaims',
  7700,
  null,
  `${q} Note 9 and tax litigation; conditional sensitivity 2026-11-18`,
  'Conditional 7,700 incremental IRS/other claim adjustment: half of disclosed 14,000 historical remaining exposure + 1,400 2026 YTD increment. Arithmetic midpoint only, NOT a probability-weighted estimate or company liability. No extra subtraction of tax reserve 538; paid deposit 6,000 and interest receivable are not added as assets, so loss of deposit is not deducted twice. Assume no additional material pension/guarantee/litigation/disposal claim outside operating forecasts and this adjustment. Future tax impact not calibrated; no audited conclusion.',
);
set(
  'shares',
  4314,
  4314,
  `${q} income statement quarter ended 2026-10-02`,
  'Historical weighted-average diluted shares used as valuation proxy, not exact current fully diluted shares. Current common shares 4,301.902335 at 2026-10-26 differ; no future SBC dilution or buyback benefit modeled.',
);
bridge.sharesBasis = 'weightedDiluted';
bridge.leaseTreatment = 'inFcff';
bridge.assetsOverlapReviewed = true;
bridge.claimsReviewed = true;
const scenarios = original.scenarios.map((s) => {
  const input = { ...s.input, bridge };
  const result = calculateDcf(input);
  assert.equal(result.ev, s.result.ev);
  assert.deepEqual(result.rows, s.result.rows);
  assert.equal(result.bridge.status, 'RESEARCH');
  assert.ok(
    Math.abs(
      result.equity - (s.result.ev + 10685 + 20710 - 41619 - 2161 - 7700),
    ) < 1e-8,
  );
  assert.ok(Math.abs(result.perShare - result.equity / 4314) < 1e-10);
  return { name: s.name, input, result };
});
const sensitivities = [0, 7700, 15400].map((claim) => ({
  conditionalIncrementalTaxClaim: claim,
  warning:
    'Conditional amounts only; 0 requires favorable resolution, not a default.',
  scenarios: scenarios.map((s) => {
    const b = structuredClone(bridge);
    b.items.otherClaims.value = claim;
    b.items.otherClaims.zeroConfirmed = claim === 0;
    const r = calculateDcf({ ...s.input, bridge: b });
    return { name: s.name, equity: r.equity, perShare: r.perShare };
  }),
}));
const blocked = structuredClone(bridge);
blocked.unresolved =
  'IRS/lease/other material claim remains unquantified without accepting the conditional assumptions';
const blockedResult = calculateDcf({ ...scenarios[1].input, bridge: blocked });
assert.equal(blockedResult.perShare, null);
assert.equal(blockedResult.equity, null);
const alt = structuredClone(bridge);
alt.items.shares.value = 4301.902335;
alt.sharesBasis = 'currentCommon';
alt.items.shares.rationale =
  'Conditional common-share proxy, ignores additional dilution; sensitivity only';
const commonShareSensitivity = scenarios.map((s) => {
  const r = calculateDcf({ ...s.input, bridge: alt });
  return { name: s.name, shares: 4301.902335, perShare: r.perShare };
});
fs.writeFileSync(
  'apps/api/tests/fixtures/financial-evidence/ko-dcf-equity-bridge.json',
  JSON.stringify(
    {
      asOf: '2026-11-18',
      units: 'USD millions; shares millions',
      type: 'CONDITIONAL_RESEARCH_ONLY',
      evidence,
      bridge,
      scenarios,
      sensitivities,
      commonShareSensitivity,
      blockedResult,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    scenarios.map((s) => ({
      name: s.name,
      ev: s.result.ev,
      equity: s.result.equity,
      perShare: s.result.perShare,
    })),
    null,
    2,
  ),
);
