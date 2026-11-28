/* eslint-disable @typescript-eslint/no-require-imports -- Read-only offline audit of public SEC fixture data. */
/* global require, console, process */
const fs = require('node:fs');
const crypto = require('node:crypto');
const {
  normalizeCompanyFacts,
} = require('../../apps/api/dist/modules/financials/normalize-company-facts');
const {
  normalizeFinancialHealth,
} = require('../../apps/api/dist/modules/financials/financial-health');
const fixtures = require('../../apps/api/tests/fixtures/balance-sheet-regression.json');
const report = {
  policyVersion: 2,
  unit: 'USD',
  productionWrites: false,
  aiCalls: 0,
  companies: [],
};
for (const [ticker, fixture] of Object.entries(fixtures)) {
  const rows = normalizeCompanyFacts(fixture.raw).annual;
  report.companies.push({
    ticker,
    sourceUrl: fixture.sourceUrl,
    fullResponseSha256: fixture.sha256,
    extractedFixtureSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(fixture.raw))
      .digest('hex'),
    periods: fixture.periodEnds.map((end) => {
      const row = rows.find((r) => r.periodEnd === end);
      if (!row) throw new Error(`Missing ${ticker} ${end}`);
      const inputs = row.sources.balanceSheetInputs;
      const annualFacts = Object.values(fixture.raw.facts['us-gaap'])
        .flatMap((c) => c.units.USD ?? [])
        .filter(
          (f) =>
            f.form === '10-K' &&
            f.end === end &&
            f.start &&
            (Date.parse(f.end) - Date.parse(f.start)) / 86400000 >= 330 &&
            (Date.parse(f.end) - Date.parse(f.start)) / 86400000 <= 400,
        )
        .sort((a, b) => a.filed.localeCompare(b.filed));
      const original = annualFacts[0];
      const read = (tag) =>
        (fixture.raw.facts['us-gaap'][tag]?.units.USD ?? []).map((fact) => ({
          fact,
          concept: `us-gaap:${tag}`,
          unit: 'USD',
        }));
      const originalSnapshot = original
        ? normalizeFinancialHealth(read, end, original.accn)
        : null;

      return {
        originalAnnualSnapshot: originalSnapshot
          ? {
              accessionNumber: original.accn,
              filed: original.filed,
              totalDebt: originalSnapshot.totalDebt,
              verifiedInputs: originalSnapshot.sources.balanceSheetInputs,
            }
          : null,
        fiscalYear: row.fiscalYear,
        reportDate: end,
        before: fixture.before.find((r) => r.periodEnd === end),
        after: {
          equity: row.equity,
          cash: row.cash,
          marketableSecurities: row.marketableSecurities,
          shortTermDebt: row.shortTermDebt,
          longTermDebt: row.longTermDebt,
          totalDebt: row.totalDebt,
        },
        verifiedInputs: inputs,
        policy: row.sources.financialHealthPolicy,
        reconciliation: row.sources.snapshotReconciliation ?? null,
        filingUrl: inputs.accessionNumber
          ? `https://www.sec.gov/Archives/edgar/data/${Number(fixture.raw.cik)}/${inputs.accessionNumber.replaceAll('-', '')}/${inputs.accessionNumber}-index.html`
          : null,
      };
    }),
  });
}
const output = process.argv.find((a) => a.startsWith('--output='))?.slice(9);
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2));
else console.log(JSON.stringify(report, null, 2));
