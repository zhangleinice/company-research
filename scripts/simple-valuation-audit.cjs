/* Read-only cached SEC and official local industry snapshot audit. No financial acquisition, AI or database writes. */
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
  const { readFileSync } = require('node:fs');
  const path = require('node:path');
  const {
    resolveSimpleSettings,
    emptySimpleSettings,
    simpleCalculationBaseline,
    setSimpleOverride,
    resetSimpleOverride,
  } = await import('../apps/web/.test-dist/src/simple-valuation-state.js');
  const { bridgeWithDefaults } =
    await import('../apps/web/.test-dist/src/equity-bridge-editor.js');
  const { calculatorInput } =
    await import('../apps/web/.test-dist/src/valuation-calculator.js');
  const {
    equityDefaultEstimates,
    historicalGrowth,
  } = require('@company-research/shared');
  const industries = require('../apps/web/src/data/industry-wacc-us.json');
  const before = await snapshot();
  let active = null;
  const forbidden = () => {
    throw Error('SEC acquisition/AI forbidden during cached audit');
  };
  const controller = new ValuationController(
    {
      resolveCompany: (ticker) =>
        db.company.findFirstOrThrow({ where: { ticker } }),
      getValuationProfile: (cik) => {
        const p = JSON.parse(
          readFileSync(
            path.join(process.argv[2] || '/tmp', `roic-${active}-sub.json`),
          ),
        );
        assert.equal(String(p.cik).padStart(10, '0'), cik);
        return {
          sic: String(p.sic),
          incorporation: p.stateOfIncorporation ?? null,
        };
      },
      getCompanyFacts: forbidden,
    },
    { getJson: forbidden },
    db,
  );
  const compactEstimate = (x) => ({ ...x, points: undefined });
  const compactResolved = (r) => ({
    ...r,
    period: r.period
      ? { label: r.period.label, start: r.period.start, end: r.period.end }
      : null,
    growth: compactEstimate(r.growth),
    growth3: compactEstimate(r.growth3),
  });
  const report = {
    checkedAt: new Date().toISOString(),
    persisted: false,
    financialRefresh: false,
    industrySource: industries.source,
    industryDate: industries.date,
    companies: [],
  };
  for (const ticker of ['GOOGL', 'AAPL', 'MSFT', 'KO']) {
    active = ticker;
    const data = await controller.simpleInputs(ticker),
      refs = (await controller.references(ticker)).equityBridge;
    const baseline = withResearchFcff(
      (await db.valuationCache.findUniqueOrThrow({ where: { cik: data.cik } }))
        .data,
    );
    const defaults = equityDefaultEstimates({ references: refs, baseline }),
      bridge = bridgeWithDefaults(refs, null, ticker, defaults);
    const run = (settings) => {
      const resolved = resolveSimpleSettings(data, settings, industries);
      const adapted = simpleCalculationBaseline(baseline, settings, resolved);
      const input = calculatorInput(adapted, {
        ...resolved.parameters,
        useResearch: settings.basis === 'manual',
        researchValue: settings.manualFcff,
        researchReason: settings.manualReason,
        bridge,
      });
      const out = calculateDcf(input);
      assert.equal(
        out.ev,
        calculateDcf({ ...input, bridge: emptyEquityBridge() }).ev,
      );
      return {
        resolved: compactResolved(resolved),
        ev: out.ev,
        equity: out.equity,
        perShare: out.perShare,
        errors: out.errors,
      };
    };
    const s = emptySimpleSettings(),
      initial = run(s),
      annual = run({ ...s, basis: 'annual' }),
      effective = run({ ...s, taxMethod: 'effective' }),
      revenue = run({ ...s, growthMethod: 'revenue' });
    const manual = setSimpleOverride(s, 'growth', 0);
    assert.equal(run(manual).resolved.parameters.growth, 0);
    assert.equal(
      run(resetSimpleOverride(manual, 'growth')).resolved.parameters.growth,
      initial.resolved.parameters.growth,
    );
    assert.equal(initial.perShare, null);
    const entry = {
      ticker,
      data,
      fcfCagr3: compactEstimate(historicalGrowth(data.annual, 'fcf', 3)),
      fcfCagr5: initial.resolved.growth,
      revenueCagr3: compactEstimate(
        historicalGrowth(data.annual, 'revenue', 3),
      ),
      revenueCagr5: revenue.resolved.growth,
      initial,
      annual,
      effective,
      revenue,
    };
    report.companies.push(entry);
    console.log(
      ticker,
      JSON.stringify({
        sic: data.sic,
        tax: initial.resolved.tax.value,
        etr: effective.resolved.tax.value,
        ttmFcff: initial.resolved.fcff.value,
        annualFcff: annual.resolved.fcff.value,
        fcf3: entry.fcfCagr3.value,
        fcf5: entry.fcfCagr5.value,
        rev3: entry.revenueCagr3.value,
        rev5: entry.revenueCagr5.value,
        industry: initial.resolved.wacc.industry,
        wacc: initial.resolved.parameters.wacc,
        g: initial.resolved.parameters.terminalGrowth,
        ev: initial.ev,
        perShare: initial.perShare,
      }),
    );
  }
  if (process.argv.includes('--http')) {
    report.httpVerification = [];
    for (const c of report.companies) {
      const response = await fetch(
        `http://localhost:3000/api/companies/${c.ticker}/valuation/simple-inputs`,
      );
      assert.equal(response.status, 200);
      const d = await response.json();
      assert.equal(d.cik, c.data.cik);
      assert.equal(d.ttm.end, c.data.ttm.end);
      assert.equal(d.ttm.taxSourceValid, c.data.ttm.taxSourceValid);
      assert.equal(d.usIncorporated, c.data.usIncorporated);
      report.httpVerification.push({
        ticker: c.ticker,
        status: response.status,
        sic: d.sic,
        usIncorporated: d.usIncorporated,
        taxSourceValid: d.ttm.taxSourceValid,
      });
      console.log(
        'HTTP',
        c.ticker,
        response.status,
        d.sic,
        d.usIncorporated,
        d.ttm.taxSourceValid,
      );
    }
  }
  assert.equal(await snapshot(), before);
  report.databaseUnchanged = true;
  if (process.argv[3])
    writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
