// Run in a normal local terminal: node scripts/diagnose-googl-growth.cjs --refresh
// Only --refresh writes data, through the existing single-company API.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { parse } = require('dotenv');

const root = path.resolve(__dirname, '..');
const env = parse(fs.readFileSync(path.join(root, 'apps/api/.env')));
const cik = '0001652044';
const keys = [
  'revenue',
  'revenueGrowth',
  'revenueCagr3y',
  'revenueCagr5y',
  'eps',
  'epsGrowth',
  'epsCagr3y',
  'epsCagr5y',
];
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const summary = (row) =>
  row &&
  Object.fromEntries([
    ['periodEnd', row.periodEnd],
    ...keys.map((key) => [key, row[key] === null ? null : Number(row[key])]),
  ]);
async function snapshot() {
  const company = await prisma.company.findUnique({ where: { cik } });
  const annual = await prisma.annualFinancial.findMany({
    where: { companyCik: cik },
    orderBy: { periodEnd: 'desc' },
    take: 10,
  });
  return {
    company: company && {
      cik: company.cik,
      financialStatus: company.financialStatus,
      lastFetchedAt: company.lastFetchedAt,
      isFavorite: company.isFavorite,
      lastError: company.lastError,
    },
    annual: annual.map((row) => ({
      ...summary(row),
      revenueSource: row.sources.revenue,
      revenueComparisonPolicy: row.sources.revenueComparisonPolicy,
    })),
  };
}
async function api(route, method = 'GET') {
  let response;
  try {
    response = await fetch(`http://localhost:3000${route}`, {
      method,
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    throw new Error(
      `API ${method} ${route}: ${error.cause?.code || error.message}`,
    );
  }
  const body = await response.json();
  if (!response.ok)
    throw new Error(`API ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function main() {
  const url = new URL(env.DATABASE_URL);
  console.log(
    'DATABASE_URL (credentials hidden):',
    `${url.protocol}//${url.hostname}:${url.port || 5432}${url.pathname}`,
  );
  // Connecting specifically to company_research verifies that it exists as well.
  await prisma.$connect();
  const database =
    await prisma.$queryRaw`SELECT current_database() AS database, current_user AS username`;
  console.log('Prisma connection:', database);
  if (database[0].database !== 'company_research') {
    throw new Error('Expected company_research; stopping before any write');
  }
  console.log('BEFORE:', JSON.stringify(await snapshot(), null, 2));
  console.log('API health:', JSON.stringify(await api('/api/health')));
  if (!process.argv.includes('--refresh')) {
    console.log(
      'Read-only checks complete. Use --refresh to refresh GOOGL and verify API/DB.',
    );
    return;
  }
  const detail = await api('/api/companies/GOOGL/refresh', 'POST');
  if (detail.cik !== cik || detail.financialStatus !== 'READY') {
    throw new Error(
      `Refresh did not complete: ${detail.financialStatus}; retry after pending acquisition finishes`,
    );
  }
  const after = await snapshot();
  console.log('AFTER:', JSON.stringify(after, null, 2));
  const cached = await api('/api/companies/GOOGL');
  const latest = [...cached.annual].sort((a, b) =>
    b.periodEnd.localeCompare(a.periodEnd),
  )[0];
  const stored = after.annual[0];
  console.log('API latest:', JSON.stringify(summary(latest), null, 2));
  if (!latest || !stored) throw new Error('No annual periods after refresh');
  for (const key of keys) {
    if (
      (latest[key] === null) !== (stored[key] === null) ||
      (latest[key] !== null && Math.abs(latest[key] - stored[key]) > 0.000001)
    ) {
      throw new Error(`API/DB mismatch: ${key}`);
    }
  }
  if (cached.lastFetchedAt !== detail.lastFetchedAt) {
    throw new Error(
      'Ordinary detail GET changed cache timestamp; inspect concurrent acquisitions',
    );
  }
  const missing = keys.filter((key) => latest[key] === null);
  if (missing.length) {
    throw new Error(
      `Refresh completed but backend metrics remain null: ${missing.join(', ')}. See AFTER revenueSource/periods; this is not a frontend formatting issue.`,
    );
  }
  console.log(
    'PASS: GOOGL refresh, persisted growth metrics and cached API agree. Reload the browser to verify rendering.',
  );
}
main()
  .catch((error) => {
    console.error('DIAGNOSIS FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
