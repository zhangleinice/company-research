/* Read-only real cached SEC data validation. Does not fetch SEC/AI, persist estimates or refresh caches. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const {
  ValuationController,
} = require('../../apps/api/dist/modules/valuation/valuation.module');
const {
  withResearchFcff,
} = require('../../apps/api/dist/modules/valuation/research-fcff');
const { calculateDcf, emptyEquityBridge } = require('@company-research/shared');
process.loadEnvFile('apps/api/.env');
const db = new PrismaClient();
const snapshot = async () =>
  createHash('sha256')
    .update(
      JSON.stringify(
        await Promise.all([
          db.annualFinancial.findMany({ orderBy: { id: 'asc' } }),
          db.quarterlyFinancial.findMany({ orderBy: { id: 'asc' } }),
          db.valuationCache.findMany({ orderBy: { cik: 'asc' } }),
          db.ownerEarningsEstimate.findMany({ orderBy: { id: 'asc' } }),
        ]),
      ),
    )
    .digest('hex');
async function main() {
  const {
    bridgeWithDefaults,
    setTableBridgeAmount,
    restoreBridgeDefault,
    usesDefaultEstimate,
  } = await import('../../apps/web/.test-dist/src/pages/CompanyDetail/Valuation/DCF/utils/equity-bridge-editor.js');
  const { calculatorInput, initialScenario } =
    await import('../../apps/web/.test-dist/src/pages/CompanyDetail/Valuation/DCF/utils/valuation-calculator.js');
  const { equityDefaultEstimates } = require('@company-research/shared');
  const before = await snapshot();
  const forbidden = () => {
    throw Error('Network acquisition forbidden');
  };
  const controller = new ValuationController(
    {
      resolveCompany: (ticker) =>
        db.company.findFirstOrThrow({ where: { ticker } }),
      getCompanyFacts: forbidden,
    },
    { getJson: forbidden },
    db,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    testOnly: true,
    persisted: false,
    companies: [],
  };
  for (const ticker of ['GOOGL', 'AAPL', 'MSFT', 'KO']) {
    const refs = (await controller.references(ticker)).equityBridge;
    const raw = JSON.stringify(refs);
    const baseline = withResearchFcff(
      (await db.valuationCache.findUniqueOrThrow({ where: { cik: refs.cik } }))
        .data,
    );
    const defaults = equityDefaultEstimates({ references: refs, baseline });
    const bridge = bridgeWithDefaults(refs, null, ticker, defaults);
    const params = {
      ...initialScenario,
      useResearch: false,
      researchValue: null,
      researchReason: '',
      bridge,
    };
    const input = calculatorInput(baseline, params),
      result = calculateDcf(input);
    const withoutBridge = calculateDcf({
      ...input,
      bridge: emptyEquityBridge(),
    });
    assert.equal(result.ev, withoutBridge.ev);
    const edited = setTableBridgeAmount(
      bridge.research,
      'cash',
      defaults.cash.value === null ? null : defaults.cash.value * 0.75,
    );
    assert.equal(usesDefaultEstimate(edited, 'cash'), false);
    const restored = restoreBridgeDefault(edited, 'cash', defaults.cash);
    assert.equal(restored.items.cash.value, defaults.cash.value);
    assert.equal(usesDefaultEstimate(restored, 'cash'), true);
    assert.equal(
      result.perShare,
      null,
      'Unresolved default claims must keep per-share unavailable',
    );
    assert.equal(JSON.stringify(refs), raw);
    if (ticker === 'AAPL') {
      assert.equal(refs.facts.annualDilutedShares.value, 14720306000);
      assert.equal(refs.facts.quarterDilutedShares.value, null);
    }
    const entry = {
      ticker,
      asOf: refs.asOf,
      policy: 'equity-defaults-v1',
      ttmRevenue: baseline.revenue,
      rawReferences: refs,
      defaults,
      ev: result.ev,
      equity: result.equity,
      perShare: result.perShare,
      fcffPolicy: baseline.fcffEstimate ?? null,
    };
    report.companies.push(entry);
    console.log(
      ticker,
      JSON.stringify({
        revenue: baseline.revenue.value,
        defaults: Object.fromEntries(
          Object.entries(defaults).map(([k, v]) => [
            k,
            { value: v.value, reason: v.reason },
          ]),
        ),
        ev: result.ev,
        equity: result.equity,
        perShare: result.perShare,
      }),
    );
  }
  assert.equal(await snapshot(), before);
  report.databaseUnchanged = true;
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
