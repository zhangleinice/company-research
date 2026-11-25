/* Isolated persistence/API service test. Does not listen on a port or contact SEC. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const {
  PrismaService,
} = require('../apps/api/dist/modules/prisma/prisma.service');
const {
  OwnerEarningsService,
  OwnerEarningsController,
} = require('../apps/api/dist/modules/valuation/owner-earnings.module');
process.loadEnvFile(resolve('apps/api/.env'));
test('isolated PostgreSQL: migration, confirmation, restart, company/year isolation, stale baseline, and API', async () => {
  const schema = `owner_earnings_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const migration = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: resolve('apps/api'),
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
    },
  );
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  const db = new PrismaService({
    datasources: { db: { url: url.toString() } },
  });
  try {
    for (const [cik, ticker] of [
      ['0000000001', 'ONE'],
      ['0000000002', 'TWO'],
    ]) {
      await db.company.create({ data: { cik, ticker } });
      for (const year of [2024, 2025]) {
        const start = `${year}-01-01`,
          end = `${year}-12-31`;
        const source = (concept, val) => ({
          items: [
            {
              concept: `us-gaap:${concept}`,
              val,
              start,
              end,
              accn: '0000000001-26-000001',
              filed: '2026-02-01',
              unit: 'USD',
              form: '10-K',
            },
          ],
        });
        await db.annualFinancial.create({
          data: {
            companyCik: cik,
            fiscalYear: year,
            fiscalQuarter: null,
            periodStart: new Date(start),
            periodEnd: new Date(end),
            currency: 'USD',
            netIncome: 50,
            operatingCashFlow: 100,
            capex: 60,
            fcf: 40,
            revenue: 200,
            sources: {
              netIncome: source('NetIncomeLoss', 50),
              operatingCashFlow: source(
                'NetCashProvidedByUsedInOperatingActivities',
                100,
              ),
              capex: source('PaymentsToAcquirePropertyPlantAndEquipment', 60),
              revenue: source('Revenues', 200),
            },
          },
        });
      }
    }
    let api = new OwnerEarningsController(new OwnerEarningsService(db));
    let state = await api.read('ONE');
    assert.equal(state.results.ownerEarnings, null);
    const y = state.history[0],
      draft = {
        periodStart: y.periodStart,
        periodEnd: y.periodEnd,
        dataVersion: y.dataVersion,
        method: 'ratio',
        ratio: 50,
        amount: null,
        comparable: true,
        rationale: 'isolated test',
      };
    const preview = await api.preview('ONE', { ...draft, comparable: false });
    assert.equal(preview.results.ownerEarnings, 70);
    assert.equal(preview.results.growthCapex, 30);
    assert.equal(preview.data.estimateStatus, 'none');
    assert.equal(await db.ownerEarningsEstimate.count(), 0);
    assert.equal((await api.read('ONE')).results.ownerEarnings, null);
    const amountPreview = await api.preview('ONE', {
      ...draft,
      method: 'amount',
      ratio: null,
      amount: 0.00012,
      comparable: false,
    });
    assert.equal(amountPreview.results.ownerEarnings, -20);
    assert.equal(amountPreview.results.growthCapex, null);
    state = await api.save('ONE', draft);
    assert.equal(state.results.ownerEarnings, 70);
    assert.equal(state.results.sbcAdjustedOwnerEarnings, null);
    api = new OwnerEarningsController(new OwnerEarningsService(db));
    state = await api.read('0000000001');
    assert.equal(state.estimate.rationale, 'isolated test');
    assert.equal(state.estimateStatus, 'confirmed');
    assert.equal((await api.read('TWO')).estimate, null);
    const saved = await db.ownerEarningsEstimate.findMany();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].periodEnd.toISOString().slice(0, 10), '2025-12-31');
    await db.ownerEarningsEstimate.create({
      data: {
        companyCik: '0000000001',
        periodEnd: new Date('2024-12-31'),
        data: {
          ...saved[0].data,
          periodEnd: '2024-12-31',
          rationale: 'older year',
        },
      },
    });
    assert.equal((await api.read('ONE')).estimate.rationale, 'isolated test');
    const row = await db.annualFinancial.findFirst({
      where: { companyCik: '0000000001', fiscalYear: 2025 },
    });
    const sources = structuredClone(row.sources);
    sources.operatingCashFlow.items[0].val = 101;
    await db.annualFinancial.update({
      where: { id: row.id },
      data: { operatingCashFlow: 101, fcf: 41, sources },
    });
    state = await api.read('ONE');
    assert.equal(state.estimateStatus, 'needs_reconfirmation');
    assert.equal(state.results.ownerEarnings, null);
    assert.equal(state.estimate.rationale, 'isolated test');
    const stalePreview = await api.preview('ONE', draft);
    assert.equal(stalePreview.data.estimateStatus, 'needs_reconfirmation');
    assert.equal(stalePreview.results.ownerEarnings, 71);
    assert.equal((await api.read('ONE')).results.ownerEarnings, null);
    assert.equal(
      (await api.read('ONE')).estimate.dataVersion,
      draft.dataVersion,
    );
    await assert.rejects(
      () => api.save('ONE', draft),
      (e) => e.getStatus() === 409,
    );
    const re = state.history[0];
    state = await api.save('ONE', {
      ...draft,
      dataVersion: re.dataVersion,
      method: 'amount',
      ratio: null,
      amount: 0,
      comparable: false,
    });
    assert.equal(state.results.ownerEarnings, 101);
    assert.equal(state.results.growthCapex, null);
    assert.equal(await db.ownerEarningsEstimate.count(), 2);
  } finally {
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
  }
});
