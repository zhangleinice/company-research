/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS tools reuse the compiled NestJS SEC client. */
/* global require, console, process */
// Stage 1 only: reuse the existing SEC client; no app bootstrap, AI or database.
const fs = require('node:fs');
const path = require('node:path');
process.loadEnvFile('apps/api/.env');
const { ConfigService } = require('@nestjs/config');
const { SecClient } = require('../../apps/api/dist/modules/sec/sec.client');
const {
  latest10K,
} = require('../../apps/api/dist/modules/ai-research/filing-parser');
const out = '/tmp/revenue-breakdown-validation';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const client = new SecClient(new ConfigService());
  try {
    for (const [name, cik] of [
      ['alphabet', '0001652044'],
      ['apple', '0000320193'],
      ['nvidia', '0001045810'],
    ]) {
      const dir = path.join(out, name);
      fs.mkdirSync(dir, { recursive: true });
      const read = async (file, url, json = false) => {
        const p = path.join(dir, file);
        if (fs.existsSync(p))
          return json
            ? JSON.parse(fs.readFileSync(p, 'utf8'))
            : fs.readFileSync(p, 'utf8');
        const r = json ? await client.getJson(url) : await client.getText(url);
        fs.writeFileSync(p, json ? JSON.stringify(r) : r);
        return r;
      };
      const submissions = await read(
        'submissions.json',
        `https://data.sec.gov/submissions/CIK${cik}.json`,
        true,
      );
      const filing = latest10K(submissions, cik);
      fs.writeFileSync(
        path.join(dir, 'metadata.json'),
        JSON.stringify({ cik, ...filing }, null, 2),
      );
      await read('filing.htm', filing.sourceUrl);
      console.log(JSON.stringify({ name, cik, ...filing }));
    }
  } finally {
    await client.onModuleDestroy();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
