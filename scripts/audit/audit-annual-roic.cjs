/* eslint-disable @typescript-eslint/no-require-imports -- Offline read-only SEC replay. */
/* global require, process, console, __dirname, module */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {
  extractDebtDisclosures,
} = require('../../apps/api/dist/modules/financials/debt-disclosure');
const {
  normalizeCompanyFacts,
} = require('../../apps/api/dist/modules/financials/normalize-company-facts');
const {
  annualRoicHistory,
  quarterlyRoicHistory,
} = require('../../apps/api/dist/modules/financials/annual-roic');
const fixture = require('../../apps/api/tests/fixtures/balance-sheet-regression.json');
const manifest = require('../../apps/api/tests/fixtures/debt-filings/manifest.json');
const latestQuarters = require('../../apps/api/tests/fixtures/debt-filings/latest-quarter-manifest.json');
const reference = require('../../apps/api/tests/fixtures/annual-roic-reference.json');
function replay({ extended = false } = {}) {
  const facts = extended
    ? JSON.parse(
        zlib
          .gunzipSync(
            fs.readFileSync(
              path.join(
                __dirname,
                '../../apps/api/tests/fixtures/roic-history-companyfacts.json.gz',
              ),
            ),
          )
          .toString(),
      )
    : fixture;
  return Object.entries(facts).map(([ticker, f]) => {
    const ref = reference.companies[ticker];
    const documents = [...manifest, ...(extended ? latestQuarters : [])].filter(
      (m) => m.ticker === ticker,
    );
    const disclosures = documents.flatMap((m) => {
      const html = zlib
        .gunzipSync(
          fs.readFileSync(
            path.join(
              __dirname,
              '../../apps/api/tests/fixtures/debt-filings',
              m.file,
            ),
          ),
        )
        .toString();
      if (crypto.createHash('sha256').update(html).digest('hex') !== m.sha256)
        throw Error('SEC fixture checksum mismatch');
      return extractDebtDisclosures(html, m);
    });
    // Simulate the JSON column round trip. No manual amounts enter this path.
    const normalized = normalizeCompanyFacts(f.raw, disclosures, ref.sic);
    const rows = JSON.parse(JSON.stringify(normalized.annual));
    const quarterlyRows = JSON.parse(JSON.stringify(normalized.quarterly));
    const quarterlyHistory = quarterlyRoicHistory(
      quarterlyRows,
      rows,
      '2026-11-24',
    );
    const history = annualRoicHistory(rows, '2026-11-24');
    return {
      ticker,
      companyFactsSource: f.sourceUrl,
      industrySourceUrl: ref.industrySourceUrl,
      documents,
      rows,
      quarterlyRows,
      quarterlyHistory,
      history,
      comparison: history.results.map((r) => {
        const manual = ref.manual.find((m) => Number(m.year) === r.fiscalYear);
        return {
          fiscalYear: r.fiscalYear,
          status: r.status,
          actualRoic: r.roic,
          manualRoic:
            manual?.ROIC_proxy == null ? null : manual.ROIC_proxy / 100,
          difference:
            r.roic == null || manual?.ROIC_proxy == null
              ? null
              : r.roic - manual.ROIC_proxy / 100,
        };
      }),
    };
  });
}
module.exports = { replay };
if (require.main === module) {
  const report = {
    policy: 'annual-roic-v1',
    amountUnit: 'USD',
    rateUnit: 'decimal',
    productionWrites: false,
    networkRequests: 0,
    aiCalls: 0,
    companies: replay({ extended: process.argv.includes('--extended') }),
  };
  const output = process.argv.find((a) => a.startsWith('--output='))?.slice(9);
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
  else console.log(JSON.stringify(report, null, 2));
}
