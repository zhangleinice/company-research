/* Offline derived cache only. Never accesses SEC, AI, Prisma or modifies source files.
 * Usage: node scripts/import-capital-flow-cache.cjs --facts /path/companyfacts.json --filings /path/manifest.json */
const fs = require('fs'),
  path = require('path'),
  z = require('zlib'),
  crypto = require('crypto');
const {
  cachedCapitalFlowFacts,
} = require('../apps/api/dist/modules/financials/capital-flow-cache');
const {
  CAPITAL_FLOW_TAGS,
} = require('../apps/api/dist/modules/financials/capital-overview');
const { CAPITAL_OVERVIEW_POLICY } = require('../packages/shared/dist');
function main() {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    if (i < 0) throw Error('Missing ' + n);
    return process.argv[i + 1];
  };
  const raw = JSON.parse(fs.readFileSync(arg('--facts'))),
    cik = String(raw.cik).padStart(10, '0');
  if (!/^\d{10}$/.test(cik)) throw Error('Invalid CIK');
  const manifestPath = arg('--filings'),
    manifest = JSON.parse(fs.readFileSync(manifestPath));
  let facts = [];
  for (const f of manifest.filter(
    (f) => f.cik === cik && (!f.filingType || f.filingType === '10-K'),
  )) {
    const file = path.resolve(path.dirname(manifestPath), f.file),
      bytes = fs.readFileSync(file),
      html = (file.endsWith('.gz') ? z.gunzipSync(bytes) : bytes).toString();
    if (
      f.sha256 &&
      crypto.createHash('sha256').update(html).digest('hex') !== f.sha256
    )
      throw Error('Cached filing hash mismatch');
    facts.push(...cachedCapitalFlowFacts(html, f));
  }
  // CompanyFacts fills historical standard tags only for the same accession as each OCF anchor.
  for (const [tag, o] of Object.entries(raw.facts?.['us-gaap'] ?? {}).filter(
    ([tag]) => CAPITAL_FLOW_TAGS.has(tag),
  ))
    for (const f of o.units?.USD ?? []) {
      if (
        !/^10-K(\/A)?$/.test(f.form) ||
        !f.start ||
        !Number.isFinite(f.val) ||
        (Date.parse(f.end) - Date.parse(f.start)) / 86400000 < 349 ||
        (Date.parse(f.end) - Date.parse(f.start)) / 86400000 > 379
      )
        continue;
      facts.push({
        concept: 'us-gaap:' + tag,
        value: f.val,
        start: f.start,
        end: f.end,
        accessionNumber: f.accn,
        filed: f.filed,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
        unit: 'USD',
      });
    }
  const dir = path.resolve(__dirname, '../apps/api/data/capital-allocation');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, cik + '.json');
  fs.writeFileSync(
    target + '.tmp',
    JSON.stringify({ version: CAPITAL_OVERVIEW_POLICY, cik, facts }),
  );
  fs.renameSync(target + '.tmp', target);
  console.log(cik, facts.length, 'offline facts imported');
}
try {
  main();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
