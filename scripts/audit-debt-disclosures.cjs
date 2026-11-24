/* eslint-disable @typescript-eslint/no-require-imports -- Read-only offline SEC verification. */
/* global require, process, console, __dirname */
const fs = require('node:fs'),
  path = require('node:path'),
  zlib = require('node:zlib'),
  crypto = require('node:crypto');
const {
  extractDebtDisclosures,
} = require('../apps/api/dist/modules/financials/debt-disclosure');
const {
  normalizeCompanyFacts,
} = require('../apps/api/dist/modules/financials/normalize-company-facts');
const fixtures = require('../apps/api/tests/fixtures/balance-sheet-regression.json');
const manifest = require('../apps/api/tests/fixtures/debt-filings/manifest.json');
const reference = require('../apps/api/tests/fixtures/debt-filings/manual-reference.json');
const report = {
  version: 'debt-disclosure-v1',
  unit: 'USD',
  productionWrites: false,
  networkRequests: 0,
  aiCalls: 0,
  companies: [],
};
const metrics = (r) => ({
  totalDebt: r.totalDebt,
  netDebt: r.netDebt,
  debtToEquity: r.debtToEquity,
  dcfPlainDebt: r.totalDebt,
});
for (const [ticker, f] of Object.entries(fixtures)) {
  const documents = manifest.filter((m) => m.ticker === ticker);
  const disclosures = documents.flatMap((m) => {
    const html = zlib
      .gunzipSync(
        fs.readFileSync(
          path.join(
            __dirname,
            '../apps/api/tests/fixtures/debt-filings',
            m.file,
          ),
        ),
      )
      .toString();
    if (crypto.createHash('sha256').update(html).digest('hex') !== m.sha256)
      throw Error('SEC fixture hash mismatch');
    return extractDebtDisclosures(html, m);
  });
  const before = normalizeCompanyFacts(f.raw).annual,
    after = normalizeCompanyFacts(f.raw, disclosures).annual;
  report.companies.push({
    ticker,
    companyFactsSource: f.sourceUrl,
    documents,
    periods: f.periodEnds.map((end) => {
      const old = before.find((r) => r.periodEnd === end),
        row = after.find((r) => r.periodEnd === end),
        i = row.sources.balanceSheetInputs;
      const ref = reference.companies[ticker][end];
      return {
        reportDate: end,
        fiscalYear: row.fiscalYear,
        preStrictOriginalValues: f.before.find((r) => r.periodEnd === end),
        phase1Strict: metrics(old),
        withDocuments: metrics(row),
        inputs: i,
        documentProof: row.sources.debtDocumentProof ?? null,
        priorManualReferenceUSD: Object.fromEntries(
          Object.entries(ref).map(([k, v]) => [k, v === null ? null : v * 1e6]),
        ),
        comparison: {
          plainMatches:
            ref.plain === null ? null : row.totalDebt === ref.plain * 1e6,
          financingMatches:
            ref.financing === null
              ? null
              : i.financingDebt.value === ref.financing * 1e6,
        },
      };
    }),
  });
}
const output = process.argv.find((a) => a.startsWith('--output='))?.slice(9);
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
else console.log(JSON.stringify(report, null, 2));
