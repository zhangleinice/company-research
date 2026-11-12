// Targeted, offline cache repair. Default is a preview; --apply commits one backed-up transaction.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { PrismaClient, Prisma } = require('@prisma/client');
const {
  normalizeCompanyFacts,
} = require('../apps/api/dist/modules/financials/normalize-company-facts');
const { FINANCIAL_METRICS } = require('@company-research/shared');
if (fs.existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env');
const db = new PrismaClient();
const targets = ['0001652044', '0000320193', '0001045810'];
const sharesCik = '0001045810';
const fields = [
  'dilutedShares',
  'dilutedSharesGrowth',
  'dividendsPerShare',
  'dpsGrowth',
];
const date = (d) => new Date(d).toISOString().slice(0, 10);
const canonical = (v) => JSON.parse(JSON.stringify(v));
const hash = (v) =>
  crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const decimal = (v) =>
  v == null
    ? null
    : new Prisma.Decimal(String(v)).toDecimalPlaces(8).toString();
const tables = [
  'company',
  'annualFinancial',
  'quarterlyFinancial',
  'aiSummary',
  'aiFiling',
  'aiTask',
  'revenueBreakdownCache',
];
async function snapshot(tx) {
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        canonical(
          await tx[table].findMany({
            orderBy:
              table === 'revenueBreakdownCache'
                ? { companyCik: 'asc' }
                : { id: 'asc' },
          }),
        ),
      ]),
    ),
  );
}
function leaves(v) {
  if (!v || typeof v !== 'object') return [];
  if (v.concept && v.accn && v.unit) return [v];
  return Object.values(v).flatMap(leaves);
}
function verify(raw, period, key) {
  const source = period.sources[key];
  assert.ok(source, `${key}: provenance required`);
  const items = leaves(source);
  assert.ok(items.length > 0);
  for (const item of items)
    assert.ok(
      raw.facts['us-gaap'][item.concept.split(':')[1]]?.units[item.unit]?.some(
        (f) =>
          ['start', 'end', 'accn', 'filed', 'form', 'val'].every(
            (k) => f[k] === item[k],
          ),
      ),
      `${key}: source missing`,
    );
  if (['dilutedShares', 'dividendsPerShare'].includes(key)) {
    assert.equal(source.method, 'reported');
    assert.equal(items[0].start, period.periodStart);
    assert.equal(items[0].end, period.periodEnd);
    assert.equal(items[0].val, period[key]);
    assert.equal(
      items[0].unit,
      key === 'dilutedShares' ? 'shares' : 'USD/shares',
    );
  } else {
    assert.equal(source.method, 'calculated');
    const [a, b] = items;
    assert.equal(a.accn, b.accn);
    assert.equal(a.start, period.periodStart);
    assert.equal(a.end, period.periodEnd);
    assert.ok(b.val > 0);
    assert.equal(decimal(period[key]), decimal((a.val / b.val - 1) * 100));
  }
}
async function main() {
  const normalized = new Map(),
    raws = new Map();
  for (const cik of targets) {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(
          process.env.QUARTERLY_AUDIT_CACHE || '/tmp/quarterly-financial-audit',
          `${cik}-companyfacts.json`,
        ),
      ),
    );
    assert.equal(String(raw.cik).padStart(10, '0'), cik);
    raws.set(cik, raw);
    normalized.set(cik, normalizeCompanyFacts(raw));
  }
  const apply = process.argv.includes('--apply');
  const output = await db.$transaction(
    async (tx) => {
      // Company acquisition takes the same row lock; do not race a live import.
      await tx.$queryRaw(
        Prisma.sql`SELECT cik FROM companies WHERE cik IN (${Prisma.join(targets)}) ORDER BY cik FOR UPDATE`,
      );
      const before = await snapshot(tx);
      for (const cik of targets) {
        const company = before.company.find((c) => c.cik === cik);
        assert.ok(company);
        assert.notEqual(
          company.financialStatus,
          'FETCHING',
          'Acquisition is active',
        );
        assert.ok(
          !before.aiTask.some(
            (t) =>
              t.companyCik === cik &&
              ['QUEUED', 'GENERATING'].includes(t.status),
          ),
          'Background task is active',
        );
      }
      const plan = [],
        retainedDifferences = [];
      for (const stored of before.quarterlyFinancial.filter((r) =>
        targets.includes(r.companyCik),
      )) {
        const n = normalized
          .get(stored.companyCik)
          .quarterly.find((r) => r.periodEnd === date(stored.periodEnd));
        assert.ok(n, 'Missing normalized period');
        assert.equal(n.periodStart, date(stored.periodStart));
        assert.equal(n.fiscalYear, stored.fiscalYear);
        assert.equal(n.fiscalQuarter, stored.fiscalQuarter);
        assert.equal(decimal(n.eps), stored.eps, 'Do not change displayed EPS');
        const data = {},
          sources = { ...stored.sources };
        const changes = [];
        if (n.epsGrowth != null)
          verify(raws.get(stored.companyCik), n, 'epsGrowth');
        if (stored.epsGrowth !== decimal(n.epsGrowth))
          changes.push({
            field: 'epsGrowth',
            before: stored.epsGrowth,
            after: decimal(n.epsGrowth),
          });
        data.epsGrowth = decimal(n.epsGrowth);
        if (n.sources.epsGrowth) sources.epsGrowth = n.sources.epsGrowth;
        else delete sources.epsGrowth;
        if (stored.companyCik === sharesCik)
          for (const key of fields) {
            if (n[key] == null) continue;
            verify(raws.get(stored.companyCik), n, key);
            if (stored[key] != null) {
              if (stored[key] !== decimal(n[key]))
                retainedDifferences.push({
                  cik: stored.companyCik,
                  end: n.periodEnd,
                  field: key,
                  before: stored[key],
                  normalized: decimal(n[key]),
                  reason: 'Existing non-null value retained',
                });
              continue;
            }
            data[key] = decimal(n[key]);
            sources[key] = n.sources[key];
            changes.push({ field: key, before: null, after: data[key] });
          }
        for (const key of FINANCIAL_METRICS) {
          if (
            key === 'epsGrowth' ||
            (stored.companyCik === sharesCik && fields.includes(key))
          )
            continue;
          if (stored[key] !== decimal(n[key]))
            retainedDifferences.push({
              cik: stored.companyCik,
              end: n.periodEnd,
              field: key,
              before: stored[key],
              normalized: decimal(n[key]),
              reason: 'Outside approved field set; retained',
            });
        }
        data.sources = canonical(sources);
        if (changes.length || !isDeepStrictEqual(stored.sources, data.sources))
          plan.push({
            id: stored.id,
            cik: stored.companyCik,
            end: n.periodEnd,
            data,
            changes,
          });
      }
      const expected = structuredClone(before);
      for (const change of plan)
        Object.assign(
          expected.quarterlyFinancial.find((r) => r.id === change.id),
          change.data,
        );
      let backup = null;
      if (apply && plan.length) {
        backup = path.resolve(
          'apps/api/data/backups',
          `quarterly-financial-fix-${Date.now()}`,
        );
        fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
        // Backup is written before any SQL mutation, and stays available if the transaction rolls back.
        fs.writeFileSync(
          path.join(backup, 'before.json'),
          JSON.stringify(before, null, 2),
          { flag: 'wx', mode: 0o600 },
        );
        fs.writeFileSync(
          path.join(backup, 'plan.json'),
          JSON.stringify(plan, null, 2),
          { flag: 'wx', mode: 0o600 },
        );
        for (const change of plan)
          await tx.quarterlyFinancial.update({
            where: { id: change.id },
            data: change.data,
          });
        const actual = await snapshot(tx);
        assert.deepEqual(
          actual,
          expected,
          'Every database field must match the allowed patch only',
        );
        fs.writeFileSync(
          path.join(backup, 'after.json'),
          JSON.stringify(actual, null, 2),
          { flag: 'wx', mode: 0o600 },
        );
      } else
        assert.deepEqual(
          await snapshot(tx),
          before,
          'Preview cannot modify data',
        );
      return {
        applied: apply,
        backup,
        sourceHashes: Object.fromEntries(
          [...raws].map(([cik, raw]) => [cik, hash(raw)]),
        ),
        beforeHash: hash(before),
        expectedAfterHash: hash(expected),
        patchedRows: plan.map(({ id, cik, end, changes }) => ({
          id,
          cik,
          end,
          changes,
        })),
        retainedDifferences,
        sourceOnlyRows: plan.filter((p) => !p.changes.length).length,
        unrelatedFieldsUnchanged: true,
      };
    },
    { timeout: 30000, isolationLevel: 'Serializable' },
  );
  const outputFile =
    process.env.QUARTERLY_FIX_OUTPUT ||
    '/tmp/quarterly-financial-fix/preview.json';
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        applied: output.applied,
        backup: output.backup,
        output: outputFile,
        rows: output.patchedRows.length,
        numericChanges: output.patchedRows.flatMap((r) => r.changes).length,
        retainedDifferences: output.retainedDifferences.length,
        unrelatedFieldsUnchanged: true,
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
