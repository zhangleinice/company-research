/* Actual cached-data integration audit. No SEC/AI calls or research/financial writes. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const {
  ValuationController,
} = require('../apps/api/dist/modules/valuation/valuation.module');
const {
  withResearchFcff,
} = require('../apps/api/dist/modules/valuation/research-fcff');
const {
  emptyBridgeResearch,
  emptyEquityBridge,
  calculateDcf,
} = require('@company-research/shared');
process.loadEnvFile('apps/api/.env');
const db = new PrismaClient();
const hash = (x) =>
  createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snapshot = async () => ({
  annual: hash(await db.annualFinancial.findMany({ orderBy: { id: 'asc' } })),
  quarter: hash(
    await db.quarterlyFinancial.findMany({ orderBy: { id: 'asc' } }),
  ),
  valuation: hash(
    await db.valuationCache.findMany({ orderBy: { cik: 'asc' } }),
  ),
  owner: hash(
    await db.ownerEarningsEstimate.findMany({ orderBy: { id: 'asc' } }),
  ),
});
async function main() {
  const { calculatorInput, initialScenario } =
    await import('../apps/web/.test-dist/src/valuation-calculator.js');
  const before = await snapshot();
  const sec = {
    resolveCompany: async (ticker) =>
      db.company.findFirstOrThrow({ where: { ticker } }),
    getCompanyFacts: () => {
      throw Error('SEC forbidden in this audit');
    },
  };
  const controller = new ValuationController(
    sec,
    {
      getJson: () => {
        throw Error('SEC forbidden');
      },
    },
    db,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    testOnly: true,
    persisted: false,
    companies: [],
  };
  for (const ticker of ['GOOGL', 'AAPL', 'MSFT', 'KO']) {
    const refs = await controller.references(ticker),
      r = emptyBridgeResearch(refs.equityBridge),
      f = r.references.facts;
    const b = withResearchFcff(
      (
        await db.valuationCache.findUniqueOrThrow({
          where: { cik: r.references.cik },
        })
      ).data,
    );
    const reason =
      'TEST ONLY: explicit conditional research assumptions, not SEC values or saved defaults.';
    for (const item of Object.values(r.items))
      Object.assign(item, { treatment: 'manual', value: 0, rationale: reason });
    r.items.cash.value = (f.cash.value / 1e6) * 0.25; // Test only: retain 25% of cash for operations.
    r.items.shortInvestments.treatment = 'reference';
    r.items.longInvestments.treatment = 'no_adjustment';
    if (f.financingDebt.status === 'VERIFIED')
      r.items.financingDebt.treatment = 'reference';
    else r.items.financingDebt.value = 50000; // Synthetic KO debt assumption, not a repaired financial fact.
    if (f.minority.value !== null || f.narrowMinority.value !== null)
      r.items.minority.treatment = 'reference';
    const preferred = [f.preferred, f.convertiblePreferred].some(
      (x) => x.value !== null && x.value > 0,
    );
    r.preferredMode = 'claim';
    if (preferred) r.items.preferred.treatment = 'reference';
    r.items.otherClaims.value = 1000; // Explicit synthetic economic-claims amount, never sum raw candidates.
    r.sharesSelection =
      f.shares.value !== null
        ? 'current'
        : f.quarterDilutedShares.value !== null
          ? 'quarterDiluted'
          : 'annualDiluted';
    r.items.shares.treatment = 'reference';
    r.assetsReviewed =
      r.claimsReviewed =
      r.leasePolicyReviewed =
      r.financingDebtScopeReviewed =
      r.minorityScopeReviewed =
      r.preferredIssuerReviewed =
      r.shareScopeReviewed =
        true;
    const params = {
      ...initialScenario,
      useResearch: ticker === 'AAPL',
      researchValue: ticker === 'AAPL' ? 100000 : null,
      researchReason: reason,
      bridge: { ...emptyEquityBridge(), research: r },
    };
    const input = calculatorInput(b, params),
      out = calculateDcf(input),
      withoutBridge = calculateDcf({ ...input, bridge: emptyEquityBridge() });
    assert.equal(out.ev, withoutBridge.ev);
    assert.equal(out.status, 'COMPLETE', out.errors.join(';'));
    const v = out.bridge.research.values;
    assert.ok(
      Math.abs(
        out.equity -
          (out.ev +
            v.cash +
            v.shortInvestments +
            v.longInvestments -
            v.financingDebt -
            v.minority -
            v.preferred -
            v.otherClaims),
      ) < 1e-7,
    );
    assert.equal(out.perShare, out.equity / out.bridge.dilutedShares);
    if (ticker === 'AAPL') {
      assert.equal(f.annualDilutedShares.value, 14720306000);
      assert.equal(f.annualBasicShares.value, 14661935000);
      assert.equal(f.quarterDilutedShares.value, null);
    }
    if (ticker === 'MSFT') assert.equal(out.bridge.debt, 106454);
    const pending = calculateDcf(
      calculatorInput(b, {
        ...params,
        bridge: {
          ...emptyEquityBridge(),
          research: emptyBridgeResearch(refs.equityBridge),
        },
      }),
    );
    assert.equal(pending.perShare, null);
    report.companies.push({
      ticker,
      referenceData: refs.equityBridge,
      testAssumptions: r,
      testFcff: params.useResearch
        ? 100000
        : 'existing conditional TTM baseline',
      testResult: {
        ev: out.ev,
        equity: out.equity,
        shares: out.bridge.dilutedShares,
        perShare: out.perShare,
        adjustments: v,
      },
      initialBlockers: pending.errors,
    });
    console.log(ticker, JSON.stringify(report.companies.at(-1).testResult));
  }
  assert.deepEqual(await snapshot(), before);
  report.databaseUnchanged = true;
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(
    'PASS: actual controller -> cached references -> shared bridge -> DCF; database content unchanged.',
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
