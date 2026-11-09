// Build API first. No HTTP listener required. --generate opts into paid calls.
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('dotenv');
const { ConfigService } = require('@nestjs/config');
Object.assign(process.env, {
  ...parse(fs.readFileSync(path.join(__dirname, '../apps/api/.env'))),
  ...process.env,
});
const base = '../apps/api/dist/modules/';
const { SecClient } = require(base + 'sec/sec.client');
const { SecService } = require(base + 'sec/sec.service');
const { PrismaService } = require(base + 'prisma/prisma.service');
const { SummaryModel } = require(base + 'ai-research/summary-model');
const { AiResearchService } = require(base + 'ai-research/ai-research.service');
const { latest10K, extractSections } = require(
  base + 'ai-research/filing-parser',
);
const config = new ConfigService();
const client = new SecClient(config);
const db = new PrismaService();
async function main() {
  const cik = '0001652044';
  const meta = latest10K(
    await client.getJson(`https://data.sec.gov/submissions/CIK${cik}.json`),
    cik,
  );
  const html = await client.getText(meta.sourceUrl);
  const sections = extractSections(html);
  console.log(
    JSON.stringify(
      {
        metadata: meta,
        sections: Object.fromEntries(
          Object.entries(sections).map(([k, v]) => [
            k,
            {
              paragraphs: v.length,
              characters: v.reduce((n, p) => n + p.text.length, 0),
              first: v[0],
              last: v.at(-1),
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes('--generate')) return;
  await db.$connect();
  const before = await db.company.findUnique({
    where: { cik },
    select: { isFavorite: true, lastFetchedAt: true },
  });
  const service = new AiResearchService(
    db,
    new SecService(client),
    client,
    new SummaryModel(config),
  );
  for (const kind of ['business', 'management']) {
    const result = await service.generate('GOOGL', kind, false);
    console.log(
      JSON.stringify(
        { kind, cached: result.cached, summary: result.summary },
        null,
        2,
      ),
    );
    const again = await service.generate('GOOGL', kind, false);
    if (
      !again.cached ||
      again.summary.id !== result.summary.id ||
      again.summary.updatedAt !== result.summary.updatedAt
    )
      throw new Error('Cache miss or unexpected regeneration');
    const state = await service.state(cik, kind);
    if (state.status !== 'READY') throw new Error('State not READY');
    console.log('CACHE PASS', kind);
  }
  const after = await db.company.findUnique({
    where: { cik },
    select: { isFavorite: true, lastFetchedAt: true },
  });
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Financial/favorite metadata changed');
  console.log(
    'PASS: summaries persisted, cached, no financial/favorite mutation',
  );
}
main()
  .catch((e) => {
    console.error(e.getResponse?.() ?? e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.onModuleDestroy();
    await db.$disconnect();
  });
