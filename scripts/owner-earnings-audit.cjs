/* Read-only by default. Optional metadata backfill uses local CompanyFacts, never SEC/AI. */
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const {
  annualOwnerEarningsInputs,
} = require('../apps/api/dist/modules/financials/owner-earnings-inputs');
const {
  ownerEarningsHistory,
  calculateOwnerEarnings,
} = require('../apps/api/dist/modules/valuation/owner-earnings');
process.loadEnvFile(resolve('apps/api/.env'));
const db = new PrismaClient();
const tickers = ['GOOGL', 'AAPL', 'MSFT', 'KO'];
const dir = process.argv[2];
const persist = process.argv.includes('--persist-inputs');
const verifyApi = process.argv.includes('--verify-api');
const output = process.argv.find((a) => a.startsWith('--output='))?.slice(9);
const iso = (d) => d.toISOString().slice(0, 10);
async function main() {
  if (!dir)
    throw Error(
      'Usage: node scripts/owner-earnings-audit.cjs <local-companyfacts-dir> [--persist-inputs] [--output=file]',
    );
  const report = {
    checkedAt: new Date().toISOString(),
    persistedInputMetadata: persist,
    companies: [],
  };
  for (const ticker of tickers) {
    const company = await db.company.findFirstOrThrow({ where: { ticker } });
    const raw = JSON.parse(readFileSync(join(dir, `roic-${ticker}.json`)));
    if (String(raw.cik).padStart(10, '0') !== company.cik)
      throw Error('CIK mismatch');
    const rows = await db.annualFinancial.findMany({
      where: { companyCik: company.cik },
      orderBy: { periodEnd: 'desc' },
      take: 10,
    });
    const enriched = rows.map((r) => {
      // The cached OCF anchor must be an exact real fact before any backfill.
      const anchor = r.sources.operatingCashFlow?.items?.[0];
      if (
        !anchor ||
        !raw.facts[
          'us-gaap'
        ].NetCashProvidedByUsedInOperatingActivities.units.USD.some(
          (f) =>
            f.start === anchor.start &&
            f.end === anchor.end &&
            f.accn === anchor.accn &&
            f.val === Number(r.operatingCashFlow),
        )
      )
        throw Error(`${ticker} OCF provenance mismatch`);
      const source = annualOwnerEarningsInputs(raw, company.cik, {
        periodStart: iso(r.periodStart),
        periodEnd: iso(r.periodEnd),
        operatingCashFlow:
          r.operatingCashFlow == null ? null : Number(r.operatingCashFlow),
        sources: r.sources,
      });
      return { ...r, sources: { ...r.sources, ownerEarningsInputs: source } };
    });
    if (persist)
      await db.$transaction(async (tx) => {
        for (let i = 0; i < rows.length; i++) {
          const updated = await tx.annualFinancial.updateMany({
            where: { id: rows[i].id, sources: { equals: rows[i].sources } },
            data: { sources: enriched[i].sources },
          });
          if (updated.count !== 1)
            throw Error(
              'Concurrent financial refresh; no partial metadata backfill permitted',
            );
        }
      });
    const history = ownerEarningsHistory(company.cik, enriched);
    let apiVerified = false;
    if (verifyApi) {
      const response = await fetch(
        `http://localhost:3000/api/companies/${company.cik}/owner-earnings`,
      );
      if (!response.ok) throw Error(`${ticker}: API ${response.status}`);
      const actual = await response.json();
      if (JSON.stringify(actual.history) !== JSON.stringify(history))
        throw Error(`${ticker}: actual API differs from checked annual inputs`);
      apiVerified = true;
    }
    const latest = history[0];
    const testDraft = {
      periodStart: latest.periodStart,
      periodEnd: latest.periodEnd,
      dataVersion: latest.dataVersion,
      method: 'ratio',
      ratio: 50,
      amount: null,
      comparable: true,
      rationale:
        'TEST ONLY: 50% cash PP&E CapEx. Never persisted as personal research.',
    };
    const keys = [
      'netIncome',
      'operatingCashFlow',
      'depreciationAmortization',
      'capex',
      'fcf',
      'sbc',
      'capexToRevenue',
      'daToRevenue',
    ];
    const coverage = Object.fromEntries(
      keys.map((k) => [
        k,
        history.filter(
          (y) =>
            (y[k] !== null && typeof y[k] === 'object' ? y[k].value : y[k]) !==
            null,
        ).length,
      ]),
    );
    report.companies.push({
      ticker,
      apiVerified,
      cik: company.cik,
      years: history.map((y) => y.fiscalYear),
      coverage,
      testAssumption: testDraft,
      testResults: calculateOwnerEarnings(latest, testDraft, true),
      history,
    });
    console.log(
      ticker,
      JSON.stringify(coverage),
      'testUSD',
      JSON.stringify(calculateOwnerEarnings(latest, testDraft, true)),
    );
  }
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
