/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS tools reuse the compiled NestJS SEC client. */
/* global require, console, process, URL */
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
process.loadEnvFile('apps/api/.env');
const { ConfigService } = require('@nestjs/config');
const { SecClient } = require('../../apps/api/dist/modules/sec/sec.client');
(async () => {
  const client = new SecClient(new ConfigService());
  try {
    for (const name of ['alphabet', 'apple', 'nvidia']) {
      const dir = '/tmp/revenue-breakdown-validation/' + name;
      const r = JSON.parse(fs.readFileSync(dir + '/candidates.json', 'utf8'));
      const base = new URL('.', r.metadata.sourceUrl);
      const read = async (href) => {
        const url = new URL(href, base);
        if (
          url.origin !== base.origin ||
          !url.pathname.startsWith(base.pathname) ||
          url.search ||
          url.hash
        )
          throw Error('cross-filing attachment rejected');
        const file = path.join(dir, path.basename(url.pathname));
        if (!fs.existsSync(file))
          fs.writeFileSync(file, await client.getText(url.href));
        return fs.readFileSync(file, 'utf8');
      };
      const refs = [];
      for (const ref of r.schemaRefs) {
        const schema = await read(ref);
        const $ = load(schema, { xmlMode: true });
        for (const n of $('*')
          .toArray()
          .filter((x) => x.name?.split(':').pop() === 'linkbaseRef')) {
          const role = n.attribs['xlink:role'];
          if (
            !['label', 'definition', 'presentation'].some((k) =>
              role?.endsWith('/' + k + 'LinkbaseRef'),
            )
          )
            continue;
          const href = n.attribs['xlink:href'];
          await read(href);
          refs.push({ role, href });
        }
      }
      fs.writeFileSync(dir + '/linkbases.json', JSON.stringify(refs, null, 2));
      console.log(name, refs);
    }
  } finally {
    await client.onModuleDestroy();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
