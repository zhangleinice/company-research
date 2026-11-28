/* eslint-disable @typescript-eslint/no-require-imports -- Offline cache enrichment reuses the compiled NestJS parser. */
/* global require, process, console, structuredClone */
// Offline-only enrichment from existing SEC response caches. Dry-run unless --apply.
// Does not request SEC, run AI, or modify financial rows. Existing DCF fields are preserved.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const {
  valuationBaseline,
} = require('../../apps/api/dist/modules/valuation/baseline');
if (fs.existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env');
const dir = process.env.DCF_CACHE_DIR;
assert.ok(dir, 'Set DCF_CACHE_DIR to the existing SEC response directory');
const db = new PrismaClient();
const bridgeOnly = process.argv.includes('--bridge-only');
const selected = process.argv.find((x) => x.startsWith('--ticker='))?.slice(9);
if (selected) assert.match(selected, /^[A-Z0-9][A-Z0-9.-]{0,19}$/);
const field = bridgeOnly ? 'bridgeDisclosures' : 'quality';
async function main() {
  const plans = [];
  for (const ticker of selected
    ? [selected]
    : ['GOOGL', 'AAPL', 'MSFT', 'KO']) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, `${ticker}-facts.json`)),
    );
    const sub = JSON.parse(
      fs.readFileSync(path.join(dir, `${ticker}-submissions.json`)),
    );
    const cik = String(raw.cik).padStart(10, '0');
    const parsed = valuationBaseline(raw, sub, ticker, cik);
    const previous = await db.valuationCache.findUnique({ where: { cik } });
    if (bridgeOnly)
      assert.ok(
        previous,
        'Bridge enrichment requires an existing valuation cache',
      );
    if (previous) {
      assert.equal(
        previous.data.asOf,
        parsed.asOf,
        'Cache reporting period changed: do not overwrite',
      );
      assert.equal(previous.data.cik, cik);
    }
    plans.push({
      ticker,
      cik,
      previous,
      data: previous ? { ...previous.data, [field]: parsed[field] } : parsed,
    });
  }
  console.log(
    JSON.stringify(
      plans.map((p) => ({
        ticker: p.ticker,
        period: p.data.asOf,
        action: p.previous
          ? `enrich-${field}-only`
          : 'create-from-existing-sec-cache',
      })),
    ),
  );
  if (!process.argv.includes('--apply')) return;
  fs.mkdirSync('artifacts', { recursive: true });
  const backup = path.join(
    'artifacts',
    `quality-cache-before-${Date.now()}.json`,
  );
  fs.writeFileSync(
    backup,
    JSON.stringify(
      plans.map((p) => ({ cik: p.cik, previous: p.previous })),
      null,
      2,
    ),
    { flag: 'wx' },
  );
  await db.$transaction(
    async (tx) => {
      for (const p of plans) {
        const current = await tx.valuationCache.findUnique({
          where: { cik: p.cik },
        });
        assert.deepEqual(
          current,
          p.previous,
          'Concurrent cache modification; abort',
        );
        const data = JSON.parse(JSON.stringify(p.data));
        await tx.valuationCache.upsert({
          where: { cik: p.cik },
          create: { cik: p.cik, data },
          update: { data },
        });
        const stored = await tx.valuationCache.findUnique({
          where: { cik: p.cik },
        });
        // PostgreSQL JSON/Prisma may round a ratio at the last binary digit.
        // All monetary facts and pre-existing DCF fields must still match exactly.
        const expected = structuredClone(data);
        if (data.quality) {
          const expectedRate = data.quality.historicalTaxRate;
          const storedRate = stored.data.quality.historicalTaxRate;
          if (expectedRate === null) assert.equal(storedRate, null);
          else
            assert.ok(
              typeof storedRate === 'number' &&
                Math.abs(storedRate - expectedRate) <=
                  Number.EPSILON * Math.max(1, Math.abs(expectedRate)),
            );
          expected.quality.historicalTaxRate = storedRate;
        }
        assert.deepEqual(stored.data, expected);
        if (p.previous) {
          const oldFields = { ...p.previous.data };
          const newFields = { ...stored.data };
          delete oldFields[field];
          delete newFields[field];
          assert.deepEqual(
            newFields,
            oldFields,
            'DCF fields must remain unchanged',
          );
        }
      }
    },
    { isolationLevel: 'Serializable', timeout: 20000 },
  );
  console.log(
    `Verified ${plans.length} caches; previous values saved in ${backup}`,
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
