// Explicit acceptance import: reuses SEC responses acquired for the coverage audit. No AI/network acquisition.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
process.loadEnvFile('apps/api/.env');
const { PrismaClient } = require('@prisma/client');
const {
  valuationBaseline,
} = require('../apps/api/dist/modules/valuation/baseline');
const { calculateDcf } = require('@company-research/shared');
const db = new PrismaClient();
async function fingerprint() {
  const tables = [
    'company',
    'annualFinancial',
    'quarterlyFinancial',
    'aiSummary',
    'aiFiling',
    'aiTask',
    'revenueBreakdownCache',
    'mergerDeal',
    'mergerImport',
  ];
  const rows = await Promise.all(
    tables.map((t) =>
      db[t].findMany({
        orderBy:
          t === 'revenueBreakdownCache' ? { companyCik: 'asc' } : { id: 'asc' },
      }),
    ),
  );
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
(async () => {
  const before = await fingerprint();
  const results = [];
  for (const [t, cik] of [
    ['GOOGL', '0001652044'],
    ['MSFT', '0000789019'],
    ['KO', '0000021344'],
  ]) {
    const raw = JSON.parse(
        fs.readFileSync(`/tmp/dcf-companyfacts-coverage/${t}-facts.json`),
      ),
      sub = JSON.parse(
        fs.readFileSync(`/tmp/dcf-companyfacts-coverage/${t}-submissions.json`),
      );
    const b = valuationBaseline(raw, sub, t, cik);
    const expected = { GOOGL: 19747, MSFT: 59957, KO: 14282 }[t] * 1e6;
    assert.equal(b.fcf, expected);
    assert.equal(b.fcff, null);
    assert.equal(b.ocf.start, b.capex.start);
    assert.equal(b.ocf.end, b.capex.end);
    await db.valuationCache.upsert({
      where: { cik },
      create: { cik, data: JSON.parse(JSON.stringify(b)) },
      update: { data: JSON.parse(JSON.stringify(b)) },
    });
    const assumptions = {
      mode: 'detailed',
      revenue: b.revenue.value / 1e6,
      historicalFcff: null,
      historicalVerified: false,
      years: Array.from({ length: 5 }, () => ({
        growth: 0.05,
        margin: 0.2,
        tax: 0.25,
        da: 0.05,
        capex: 0.1,
        deltaNwc: 100,
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
      applicable: b.applicable,
      assumptions:
        'Acceptance-only synthetic assumptions, NOT company forecasts: five years growth5%, margin20%, tax25%, D&A5%, CapEx10%, NWC+100m/year; WACC10%, g2%. Equity bridge remains missing.',
    };
    const detailed = calculateDcf(assumptions);
    assert.ok(detailed.ev > 0);
    assert.equal(detailed.perShare, null);
    const simple = calculateDcf({ ...assumptions, mode: 'simple' });
    assert.equal(simple.ev, null);
    results.push({
      ticker: t,
      baseline: b,
      syntheticAssumptions: assumptions,
      example: detailed,
      simpleDisabled: true,
      companyValuationComplete: false,
    });
  }
  assert.equal(await fingerprint(), before);
  const out = {
    validatedAt: new Date().toISOString(),
    unrelatedDataUnchanged: true,
    results,
  };
  fs.writeFileSync(
    'docs/validation/dcf-v1-acceptance.json',
    JSON.stringify(out, null, 2) + '\n',
  );
  console.log(
    results.map((r) => ({
      ticker: r.ticker,
      fcf: r.baseline.fcf,
      simpleFcff: r.baseline.fcff,
      syntheticEV: r.example.ev,
      perShare: r.example.perShare,
    })),
  );
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
