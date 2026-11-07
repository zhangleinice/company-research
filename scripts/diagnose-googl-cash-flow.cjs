// Only --refresh writes, through the existing single-company API. No database deletes.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { parse } = require('dotenv');
const env = parse(fs.readFileSync(path.resolve(__dirname, '../apps/api/.env')));
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const cik = '0001652044';
const keys = [
  'revenue',
  'operatingCashFlow',
  'capex',
  'fcf',
  'fcfMargin',
  'fcfGrowth',
  'netIncome',
  'stockRepurchases',
  'dividendsPaid',
];
const ratio = (row) =>
  row.capex !== null && row.operatingCashFlow > 0
    ? (Number(row.capex) / Number(row.operatingCashFlow)) * 100
    : null;
const summary = (row) => ({
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  ...Object.fromEntries(
    keys.map((key) => [key, row[key] === null ? null : Number(row[key])]),
  ),
  capexToOcf: row.capexToOcf === undefined ? ratio(row) : row.capexToOcf,
});
function equal(actual, expected, label) {
  if (
    actual === undefined ||
    !(
      (actual === null && expected === null) ||
      (actual !== null &&
        expected !== null &&
        Number.isFinite(Number(actual)) &&
        Math.abs(Number(actual) - Number(expected)) <= 0.00001)
    )
  ) {
    throw new Error(`${label}: actual=${actual}, expected=${expected}`);
  }
}
const cashSources = (row) =>
  row &&
  Object.fromEntries(
    [...keys, 'capexToOcf', 'growthComparisonPeriodEnd'].map((key) => [
      key,
      row.sources[key],
    ]),
  );
async function snapshot() {
  const company = await prisma.company.findUnique({ where: { cik } });
  const where = {
    where: { companyCik: cik },
    orderBy: { periodEnd: 'desc' },
    take: 10,
  };
  const annual = await prisma.annualFinancial.findMany(where);
  const quarterly = await prisma.quarterlyFinancial.findMany(where);
  return {
    company: company && {
      financialStatus: company.financialStatus,
      lastFetchedAt: company.lastFetchedAt,
      isFavorite: company.isFavorite,
      lastError: company.lastError,
    },
    annual: annual.map(summary),
    quarterly: quarterly.map(summary),
    annualSources: cashSources(annual[0]),
    q4Sources: cashSources(
      quarterly.find((row) =>
        row.periodEnd.toISOString().startsWith('2025-12-31'),
      ),
    ),
  };
}
async function api(route, method = 'GET') {
  const response = await fetch(`http://localhost:3000${route}`, {
    method,
    signal: AbortSignal.timeout(180000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function main() {
  await prisma.$connect();
  const database =
    await prisma.$queryRaw`SELECT current_database() AS database`;
  if (database[0].database !== 'company_research')
    throw new Error('Expected company_research; stopping before writes');
  console.log('Prisma connection:', database);
  const before = await snapshot();
  console.log(
    'BEFORE:',
    JSON.stringify(
      { company: before.company, latest: before.annual[0] },
      null,
      2,
    ),
  );
  if (!process.argv.includes('--refresh'))
    return console.log('Read-only complete. Add --refresh to update GOOGL.');
  const refreshed = await api('/api/companies/GOOGL/refresh', 'POST');
  if (refreshed.cik !== cik || refreshed.financialStatus !== 'READY')
    throw new Error('Acquisition not complete; retry later');
  const stored = await snapshot();
  const cached = await api('/api/companies/GOOGL');
  if (cached.lastFetchedAt !== refreshed.lastFetchedAt)
    throw new Error('Cache timestamp changed on ordinary GET');
  if (before.company && stored.company.isFavorite !== before.company.isFavorite)
    throw new Error('Favorite state changed');
  for (const mode of ['annual', 'quarterly']) {
    for (const row of cached[mode]) {
      const saved = stored[mode].find(
        (x) => x.periodEnd.toISOString().slice(0, 10) === row.periodEnd,
      );
      if (!saved) throw new Error(`Missing DB row: ${row.periodEnd}`);
      for (const key of [...keys, 'capexToOcf'])
        equal(
          row[key],
          saved[key],
          `${mode}/${row.periodEnd}/${key} API vs DB`,
        );
      const fcf =
        row.operatingCashFlow !== null && row.capex !== null
          ? row.operatingCashFlow - row.capex
          : null;
      equal(row.fcf, fcf, `${row.periodEnd} FCF`);
      equal(row.capexToOcf, ratio(row), `${row.periodEnd} CapEx/OCF`);
      equal(
        row.fcfMargin,
        fcf !== null && row.revenue > 0 ? (fcf / row.revenue) * 100 : null,
        `${row.periodEnd} FCF Margin`,
      );
    }
  }
  console.log('AFTER:', JSON.stringify(stored, null, 2));
  const latest2025 = cached.annual.find(
    (row) => row.periodEnd === '2025-12-31',
  );
  if (!latest2025) throw new Error('2025 annual period not returned');
  const expected = {
    revenue: 402836e6,
    operatingCashFlow: 164713e6,
    capex: 91447e6,
    fcf: 73266e6,
    fcfMargin: (73266 / 402836) * 100,
    fcfGrowth: (73266 / 72764 - 1) * 100,
    netIncome: 132170e6,
    stockRepurchases: 45709e6,
    dividendsPaid: 10049e6,
    capexToOcf: (91447 / 164713) * 100,
  };
  for (const [key, value] of Object.entries(expected))
    equal(latest2025[key], value, `2025 10-K ${key}`);
  console.log('API 2025:', JSON.stringify(summary(latest2025), null, 2));
  // Verify each Q4 cash-flow difference against its persisted original observations.
  const q4 = cached.quarterly.find((row) => row.periodEnd === '2025-12-31');
  if (!q4) throw new Error('2025 Q4 not present in the latest ten quarters');
  for (const key of [
    'operatingCashFlow',
    'capex',
    'stockRepurchases',
    'dividendsPaid',
  ]) {
    const provenance = stored.q4Sources?.[key];
    if (q4[key] === null) {
      console.log(`UNVERIFIED Q4 ${key}: null`);
      continue;
    }
    if (!provenance?.items?.length) throw new Error(`Missing Q4 source ${key}`);
    const items = provenance.items;
    if (provenance.method === 'reported') {
      if (items[0].start !== q4.periodStart || items[0].end !== q4.periodEnd)
        throw new Error(`Wrong independent Q4 ${key}`);
      equal(q4[key], items[0].val, `Q4 reported ${key}`);
    } else if (provenance.method === 'ytd_difference') {
      if (
        items.length !== 2 ||
        items[0].start !== items[1].start ||
        items[0].end !== q4.periodEnd ||
        items[1].end !== '2025-09-30' ||
        items[0].concept !== items[1].concept ||
        items[0].unit !== items[1].unit
      )
        throw new Error(`Invalid Q4 endpoints ${key}`);
      equal(q4[key], items[0].val - items[1].val, `Q4 YTD ${key}`);
    } else throw new Error(`Unsupported Q4 source ${key}`);
  }
  console.log('API Q4:', JSON.stringify(summary(q4), null, 2));
  console.log(
    'PASS: GOOGL annual/quarterly DB and API agree; 2025 cash figures reconcile to 10-K; Q4 available sources checked; favorite preserved. Browser not verified by this script.',
  );
}
main()
  .catch((error) => {
    console.error('DIAGNOSIS FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
