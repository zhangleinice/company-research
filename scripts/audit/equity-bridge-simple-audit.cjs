/* Read-only cached-data verification of the restored, conservative bridge table. */
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
  const { referenceBridgeResearch, editableBridge } =
    await import('../../apps/web/.test-dist/src/pages/CompanyDetail/Valuation/DCF/utils/equity-bridge-editor.js');
  const { calculatorInput, initialScenario } =
    await import('../../apps/web/.test-dist/src/pages/CompanyDetail/Valuation/DCF/utils/valuation-calculator.js');
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
    const original = JSON.stringify(refs);
    const baseline = withResearchFcff(
      (await db.valuationCache.findUniqueOrThrow({ where: { cik: refs.cik } }))
        .data,
    );
    const r = referenceBridgeResearch(refs);
    const run = (research, manual = false) =>
      calculateDcf(
        calculatorInput(baseline, {
          ...initialScenario,
          useResearch: manual,
          researchValue: manual ? 100000 : null,
          researchReason: manual
            ? 'TEST ONLY: synthetic manual FCFF 100000; not a default'
            : '',
          bridge: { ...emptyEquityBridge(), research },
        }),
      );
    const initial = run(r);
    assert.equal(initial.equity, null);
    assert.equal(initial.perShare, null);
    assert.notEqual(r.preliminary, true);
    for (const key of [
      'cash',
      'shortInvestments',
      'longInvestments',
      'minority',
      'preferred',
      'otherClaims',
      'shares',
    ]) {
      assert.equal(r.items[key].value, null);
      assert.equal(initial.bridge.research.values[key], null);
    }
    const f = refs.facts.financingDebt;
    const expectedDebt =
      f.status === 'VERIFIED' && refs.financingDebtIncludesLeases === true
        ? f.value / 1e6
        : null;
    assert.equal(initial.bridge.research.values.financingDebt, expectedDebt);
    const reset = run(editableBridge(refs, null, ticker).research);
    assert.equal(reset.ev, initial.ev);
    assert.equal(reset.equity, null);
    assert.equal(JSON.stringify(refs), original);
    if (ticker === 'AAPL') {
      assert.equal(refs.facts.annualDilutedShares.value, 14720306000);
      assert.equal(refs.facts.quarterDilutedShares.value, null);
    }
    const summarize = (o) => ({
      ev: o.ev,
      equity: o.equity,
      perShare: o.perShare,
      shares: o.bridge.dilutedShares,
      adjustments: o.bridge.research.values,
      omitted: o.bridge.research.omitted,
      errors: o.errors,
    });
    const entry = {
      ticker,
      asOf: refs.asOf,
      fingerprint: refs.fingerprint,
      initial: summarize(initial),
    };
    report.companies.push(entry);
    console.log(ticker, JSON.stringify(entry));
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
