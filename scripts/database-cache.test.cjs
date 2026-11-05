// Explicit integration test. Uses a new isolated schema and never resets the application's schema.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const apiRequire = createRequire(resolve('apps/api/package.json'));
const env = resolve('apps/api/.env');
if (existsSync(env)) process.loadEnvFile(env);
const { PrismaService } = apiRequire('./dist/modules/prisma/prisma.service');
const { CompanyService } = apiRequire('./dist/modules/company/company.service');
const { FinancialService } = apiRequire(
  './dist/modules/financials/financial.service',
);

const directory = [
  { ticker: 'GOOG', cik: '0001652044', name: 'GOOG synthetic test fixture' },
  { ticker: 'AAPL', cik: '0000320193', name: 'AAPL synthetic test fixture' },
  { ticker: 'KO', cik: '0000021344', name: 'KO synthetic test fixture' },
];
function facts(cik) {
  const entries = [];
  for (let year = 2012; year <= 2025; year++)
    entries.push({
      val: year * 100,
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      fy: year,
      fp: 'FY',
      form: '10-K',
      filed: `${year + 1}-02-01`,
      accn: `annual-${year}`,
    });
  for (let year = 2023; year <= 2026; year++)
    for (let quarter = 1; quarter <= 3; quarter++)
      entries.push({
        val: quarter * 100,
        start: `${year}-${quarter === 1 ? '01-01' : quarter === 2 ? '04-01' : '07-01'}`,
        end: `${year}-${quarter === 1 ? '03-31' : quarter === 2 ? '06-30' : '09-30'}`,
        fy: year,
        fp: `Q${quarter}`,
        form: '10-Q',
        filed: `${year}-${quarter === 1 ? '05-01' : quarter === 2 ? '08-01' : '11-01'}`,
        accn: `quarter-${year}-${quarter}`,
      });
  return {
    cik,
    facts: { 'us-gaap': { Revenues: { units: { USD: entries } } } },
  };
}
test('PostgreSQL cache: list/search, favorites, first detail, persistence, aliases, deduplication and retry', async (t) => {
  assert.ok(
    process.env.DATABASE_URL,
    'Set DATABASE_URL before running the database integration test',
  );
  const schema = `company_research_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const migration = spawnSync(
    process.execPath,
    [apiRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: resolve('apps/api'),
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
    },
  );
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  const prisma = new PrismaService({
    datasources: { db: { url: url.toString() } },
  });
  await prisma.$connect();
  t.after(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await prisma.$disconnect();
  });
  let factsCalls = 0;
  let failKo = true;
  const sec = {
    getCompanies: async (page, limit, q = '') => {
      const rows = directory.filter(
        (x) =>
          !q ||
          x.name.toLowerCase().includes(q.toLowerCase()) ||
          x.ticker.toLowerCase().includes(q.toLowerCase()),
      );
      return {
        total: rows.length,
        page,
        limit,
        data: rows.slice((page - 1) * limit, page * limit),
      };
    },
    resolveCompany: async (input) =>
      input === 'GOOGL'
        ? { ...directory[0], ticker: 'GOOGL' }
        : directory.find((x) => x.ticker === input || x.cik === input),
    getCompany: async () => ({ industry: 'Synthetic test industry' }),
    getCompanyFacts: async (cik) => {
      factsCalls++;
      if (cik === '0000021344' && failKo) {
        failKo = false;
        throw new Error('Synthetic SEC outage');
      }
      return facts(cik);
    },
  };
  const service = new CompanyService(sec, new FinancialService(), prisma);
  const first = await service.getCompanies(1, 10);
  assert.equal(first.total, 3);
  assert.equal(first.data[0].financial, null);
  assert.equal(first.data[0].financialStatus, 'NOT_FETCHED');
  await service.search('AAPL');
  await service.getCompanies(1, 10, 'KO', 'quarterly');
  await service.setFavorite(directory[0].cik, true);
  assert.equal(factsCalls, 0);
  assert.equal(
    (await service.getCompanies(1, 10, '', 'annual', true)).data[0]
      .financialStatus,
    'NOT_FETCHED',
  );
  await Promise.all([service.getCompany('GOOG'), service.getCompany('GOOGL')]);
  assert.equal(factsCalls, 1);
  assert.equal(
    await prisma.company.count({ where: { cik: directory[0].cik } }),
    1,
  );
  assert.equal(
    await prisma.annualFinancial.count({
      where: { companyCik: directory[0].cik },
    }),
    10,
  );
  assert.equal(
    await prisma.quarterlyFinancial.count({
      where: { companyCik: directory[0].cik },
    }),
    10,
  );
  const reopened = new CompanyService(sec, new FinancialService(), prisma);
  assert.equal((await reopened.getCompany('GOOG')).financialStatus, 'READY');
  assert.equal(factsCalls, 1);
  assert.equal(
    (await reopened.getCompanies(1, 10)).data[0].financial.revenue,
    202500,
  );
  await reopened.setFavorite(directory[0].cik, false);
  assert.equal(
    await prisma.annualFinancial.count({
      where: { companyCik: directory[0].cik },
    }),
    10,
  );
  assert.equal(
    (await reopened.getCompanies(1, 10, '', 'annual', true)).total,
    0,
  );
  await reopened.getCompany('AAPL');
  await assert.rejects(reopened.getCompany('KO'), /Synthetic SEC outage/);
  assert.equal(
    (await prisma.company.findUnique({ where: { cik: directory[2].cik } }))
      .financialStatus,
    'FAILED',
  );
  assert.equal(
    await prisma.annualFinancial.count({
      where: { companyCik: directory[2].cik },
    }),
    0,
  );
  assert.equal((await reopened.getCompany('KO')).financialStatus, 'READY');
  assert.equal(await prisma.company.count(), 3);
});
