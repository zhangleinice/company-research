// Read-only audit. Requires locally cached CompanyFacts; never fetches SEC or runs updates/AI.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  normalizeCompanyFacts,
} = require('../apps/api/dist/modules/financials/normalize-company-facts');
const {
  CompanyService,
} = require('../apps/api/dist/modules/company/company.service');
const { FINANCIAL_METRICS } = require('@company-research/shared');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('cheerio');
if (fs.existsSync('apps/api/.env')) process.loadEnvFile('apps/api/.env');
const db = new PrismaClient();
const directory =
  process.env.QUARTERLY_AUDIT_CACHE || '/tmp/quarterly-financial-audit';
const targets = ['0001652044', '0000320193', '0001045810'];
const date = (x) =>
  x instanceof Date ? x.toISOString().slice(0, 10) : x?.slice(0, 10);
const num = (x) => (x == null ? null : Number(x));
const near = (a, b) =>
  a === b || (a != null && b != null && Math.abs(a - b) < 0.0000001);
const day = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
const hash = (v) =>
  crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function leaves(value) {
  if (!value || typeof value !== 'object') return [];
  if (value.concept && value.accn && value.unit && value.end) return [value];
  return Object.values(value).flatMap(leaves);
}
function observations(raw, concept, unit = 'USD') {
  return (
    raw.facts[concept.split(':')[0]]?.[concept.split(':')[1]]?.units[unit] || []
  );
}
function latest(values) {
  return [...values].sort(
    (a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn),
  )[0];
}
function sourceExists(raw, s) {
  return observations(raw, s.concept, s.unit).some((f) =>
    ['start', 'end', 'val', 'accn', 'filed', 'form'].every(
      (k) => f[k] === s[k],
    ),
  );
}
async function snapshot(tx) {
  const companies = await tx.company.findMany({
    where: { cik: { in: targets } },
    orderBy: { cik: 'asc' },
    include: {
      annualFinancials: { orderBy: { periodEnd: 'desc' } },
      quarterlyFinancials: { orderBy: { periodEnd: 'desc' } },
    },
  });
  const summaries = await tx.aiSummary.findMany({ orderBy: { id: 'asc' } });
  const tasks = await tx.aiTask.findMany({ orderBy: { id: 'asc' } });
  return { companies, summaries, tasks };
}
async function readonly(work) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return work(tx);
    },
    { timeout: 30000 },
  );
}
async function main() {
  const { FinancialAnalysis } =
    await import('../apps/web/.test-dist/src/analysis/FinancialAnalysis.js');
  const { FinancialTrendChart } =
    await import('../apps/web/.test-dist/src/analysis/FinancialTrendChart.js');
  const { METRICS, analysisValue, formatAnalysisValue } =
    await import('../apps/web/.test-dist/src/analysis/financial-analysis.js');
  const before = await readonly(snapshot);
  const output = {
    auditedAt: new Date().toISOString(),
    networkRequestsByAuditScript: 0,
    companies: [],
  };
  for (const company of before.companies) {
    const file = path.join(directory, `${company.cik}-companyfacts.json`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(String(raw.cik).padStart(10, '0'), company.cik);
    const normalized = normalizeCompanyFacts(raw);
    const provenanceFailures = [],
      periodFailures = [],
      formulaFailures = [],
      cacheDifferences = [],
      crosschecks = [],
      epsComparisons = [];
    let sourceOccurrences = 0;
    const quarterSummary = [];
    const priorCache = new Map();
    function priorPeriod(end) {
      if (!priorCache.has(end)) {
        const trimmed = {
          ...raw,
          facts: Object.fromEntries(
            Object.entries(raw.facts).map(([namespace, tags]) => [
              namespace,
              Object.fromEntries(
                Object.entries(tags).map(([tag, definition]) => [
                  tag,
                  {
                    ...definition,
                    units: Object.fromEntries(
                      Object.entries(definition.units).map(([unit, facts]) => [
                        unit,
                        facts.filter((f) => f.end <= end),
                      ]),
                    ),
                  },
                ]),
              ),
            ]),
          ),
        };
        priorCache.set(
          end,
          normalizeCompanyFacts(trimmed).quarterly.find(
            (r) => r.periodEnd === end,
          ),
        );
      }
      return priorCache.get(end);
    }
    let yoyChecks = 0;
    for (const stored of company.quarterlyFinancials) {
      const start = date(stored.periodStart),
        end = date(stored.periodEnd);
      const fresh = normalized.quarterly.find((p) => p.periodEnd === end);
      assert.ok(fresh, 'period must exist in fresh normalization');
      for (const k of FINANCIAL_METRICS)
        if (!near(num(stored[k]), fresh[k]))
          cacheDifferences.push({
            end,
            metric: k,
            stored: num(stored[k]),
            normalized: fresh[k],
          });
      if (
        start !== fresh.periodStart ||
        stored.fiscalQuarter !== fresh.fiscalQuarter ||
        stored.fiscalYear !== fresh.fiscalYear
      )
        periodFailures.push({ end, reason: 'cached period identity differs' });
      for (const s of leaves(stored.sources)) {
        sourceOccurrences++;
        if (!sourceExists(raw, s)) provenanceFailures.push(s);
      }
      for (const key of [
        'revenue',
        'grossProfit',
        'operatingIncome',
        'netIncome',
        'eps',
        'operatingCashFlow',
        'capex',
        'stockRepurchases',
        'dividendsPerShare',
        'dilutedShares',
      ]) {
        const s = stored.sources[key];
        if (!s) continue;
        if (s.method === 'reported') {
          const f = s.items[0];
          if (
            f.start !== start ||
            f.end !== end ||
            !near(num(stored[key]), f.val)
          )
            periodFailures.push({
              end,
              key,
              reason: 'direct duration mismatch',
            });
        } else if (s.method === 'ytd_difference') {
          const [a, b] = s.items;
          if (
            a.start !== b.start ||
            a.end !== end ||
            day(b.end, start) !== 2 ||
            !near(num(stored[key]), a.val - b.val)
          )
            periodFailures.push({
              end,
              key,
              reason: 'YTD boundary/value mismatch',
            });
          assert.ok(
            !['eps', 'dilutedShares', 'dividendsPerShare'].includes(key),
          );
        }
      }
      const gross = stored.sources.grossProfit;
      if (
        gross?.method === 'calculated' &&
        gross.formula === 'revenue-costOfRevenue'
      ) {
        const [, cost, priorCost] = gross.inputs;
        const expected =
          num(stored.revenue) -
          (gross.costMethod === 'ytd_difference'
            ? cost.val - priorCost.val
            : cost.val);
        if (!near(num(stored.grossProfit), expected))
          formulaFailures.push({ end, key: 'grossProfit', expected });
      }
      function healthAmount(s) {
        if (!s) return null;
        if (s.method === 'reported') return s.items[0].val;
        if (s.method === 'sum_current_borrowings')
          return s.items.reduce((sum, f) => sum + f.val, 0);
        if (s.method === 'exclude_current_finance_leases')
          return s.items[0].val - s.items[1].val;
        if (s.method === 'exclude_finance_leases')
          return s.items[0].val - (s.items[1].val - s.items[2].val);
        if (s.formula === 'currentDebt+noncurrentDebt')
          return s.inputs.reduce((sum, input) => sum + healthAmount(input), 0);
        throw new Error('Unexpected health provenance method');
      }
      for (const key of [
        'cash',
        'marketableSecurities',
        'currentAssets',
        'currentLiabilities',
        'equity',
        'shortTermDebt',
        'longTermDebt',
        'totalDebt',
      ]) {
        if (
          stored[key] != null &&
          stored.sources[key] &&
          !near(num(stored[key]), healthAmount(stored.sources[key]))
        )
          formulaFailures.push({
            end,
            key,
            reason: 'balance source arithmetic mismatch',
          });
        for (const f of leaves(stored.sources[key]))
          if (f.start || f.end !== end)
            periodFailures.push({ end, key, reason: 'instant date mismatch' });
      }
      const formulas = {
        fcf:
          stored.operatingCashFlow == null || stored.capex == null
            ? null
            : num(stored.operatingCashFlow) - num(stored.capex),
      };
      for (const [out, a, b, m] of [
        ['grossMargin', 'grossProfit', 'revenue', 100],
        ['operatingMargin', 'operatingIncome', 'revenue', 100],
        ['netMargin', 'netIncome', 'revenue', 100],
        ['currentRatio', 'currentAssets', 'currentLiabilities', 1],
        ['debtToEquity', 'totalDebt', 'equity', 1],
      ])
        formulas[out] =
          stored[a] != null && num(stored[b]) > 0
            ? (num(stored[a]) / num(stored[b])) * m
            : null;
      formulas.totalDebt =
        stored.shortTermDebt == null || stored.longTermDebt == null
          ? null
          : num(stored.shortTermDebt) + num(stored.longTermDebt);
      for (const [k, v] of Object.entries(formulas))
        if (!near(num(stored[k]), v))
          formulaFailures.push({
            end,
            key: k,
            stored: num(stored[k]),
            expected: v,
          });
      for (const out of ['dilutedSharesGrowth', 'dpsGrowth']) {
        if (stored[out] == null) continue;
        const [now, previous] = stored.sources[out].items;
        assert.equal(now.accn, previous.accn);
        assert.equal(now.start, start);
        assert.equal(now.end, end);
        assert.ok(
          day(previous.start, previous.end) >= 60 &&
            day(previous.start, previous.end) <= 110,
        );
        assert.ok(
          day(previous.end, end) >= 330 && day(previous.end, end) <= 400,
        );
        assert.ok(near(num(stored[out]), (now.val / previous.val - 1) * 100));
        yoyChecks++;
      }
      const priorEnd = stored.sources.growthComparisonPeriodEnd;
      if (priorEnd) {
        const previous = priorPeriod(priorEnd);
        assert.ok(previous);
        assert.equal(previous.fiscalQuarter, stored.fiscalQuarter);
        assert.equal(previous.fiscalYear, stored.fiscalYear - 1);
        for (const [out, key] of [
          ['revenueGrowth', 'revenue'],
          ['epsGrowth', 'eps'],
        ]) {
          if (stored[out] == null) continue;
          assert.ok(
            near(
              num(stored[out]),
              (num(stored[key]) / previous[key] - 1) * 100,
            ),
          );
          yoyChecks++;
        }
      }
      if (stored.eps != null && stored.epsGrowth != null && priorEnd) {
        const evidence = stored.sources.epsGrowth;
        assert.equal(evidence?.method, 'calculated');
        const [now, comparablePrior] = evidence.items;
        assert.equal(now.accn, comparablePrior.accn);
        assert.equal(now.filed, comparablePrior.filed);
        assert.equal(now.val, num(stored.eps));
        const old = latest(
          observations(raw, now.concept, now.unit).filter(
            (f) =>
              f.end === priorEnd &&
              f.start &&
              day(f.start, f.end) >= 60 &&
              day(f.start, f.end) <= 110,
          ),
        );
        const same =
          old &&
          observations(raw, now.concept, now.unit).find(
            (f) =>
              f.start === old.start &&
              f.end === old.end &&
              f.accn === now.accn &&
              f.val === old.val,
          );
        assert.ok(old);
        assert.equal(old.val, comparablePrior.val);
        assert.ok(near(num(stored.epsGrowth), (now.val / old.val - 1) * 100));
        epsComparisons.push({
          end,
          eps: num(stored.eps),
          growth: num(stored.epsGrowth),
          current: now,
          prior: comparablePrior,
          sameAccessionPairExists: !!same,
        });
      }
      quarterSummary.push({
        fy: stored.fiscalYear,
        q: stored.fiscalQuarter,
        start,
        end,
        days: day(start, end),
        values: Object.fromEntries(
          [
            'revenue',
            'revenueGrowth',
            'eps',
            'epsGrowth',
            'grossMargin',
            'operatingMargin',
            'netMargin',
            'roe',
            'operatingCashFlow',
            'capex',
            'fcf',
            'cash',
            'marketableSecurities',
            'totalDebt',
            'currentRatio',
            'debtToEquity',
            'stockRepurchases',
            'dilutedShares',
            'dilutedSharesGrowth',
            'dividendsPerShare',
            'dpsGrowth',
          ].map((k) => [k, num(stored[k])]),
        ),
        methods: Object.fromEntries(
          [
            'revenue',
            'eps',
            'operatingCashFlow',
            'capex',
            'stockRepurchases',
            'dilutedShares',
            'dividendsPerShare',
          ].map((k) => [k, stored.sources[k]?.method ?? null]),
        ),
      });
    }
    for (const annual of company.annualFinancials) {
      const quarters = company.quarterlyFinancials
        .filter((q) => q.fiscalYear === annual.fiscalYear)
        .sort((a, b) => a.fiscalQuarter - b.fiscalQuarter);
      if (
        quarters.length !== 4 ||
        new Set(quarters.map((q) => q.fiscalQuarter)).size !== 4
      )
        continue;
      assert.equal(date(quarters[0].periodStart), date(annual.periodStart));
      assert.equal(date(quarters[3].periodEnd), date(annual.periodEnd));
      for (let i = 1; i < 4; i++)
        assert.equal(
          day(date(quarters[i - 1].periodEnd), date(quarters[i].periodStart)),
          2,
        );
      const flows = Object.fromEntries(
        ['revenue', 'netIncome', 'operatingCashFlow', 'capex'].map((k) => {
          const complete =
            quarters.every((q) => q[k] != null) && annual[k] != null;
          const sum = complete
            ? quarters.reduce((s, q) => s + num(q[k]), 0)
            : null;
          return [
            k,
            {
              annual: num(annual[k]),
              quarters: quarters.map((q) => num(q[k])),
              sum,
              difference: complete ? sum - num(annual[k]) : null,
            },
          ];
        }),
      );
      crosschecks.push({
        fy: annual.fiscalYear,
        start: date(annual.periodStart),
        end: date(annual.periodEnd),
        days: day(date(annual.periodStart), date(annual.periodEnd)),
        flows,
        balanceMismatches: [
          'cash',
          'marketableSecurities',
          'totalDebt',
          'currentRatio',
          'debtToEquity',
        ].filter((k) => !near(num(annual[k]), num(quarters[3][k]))),
      });
    }
    // Call the actual Nest service serialization within a read-only transaction.
    // Existing-company createMany becomes a no-op existence check; any SEC/acquisition call fails.
    assert.equal(
      new Set(company.quarterlyFinancials.map((r) => date(r.periodEnd))).size,
      company.quarterlyFinancials.length,
    );
    const detail = await readonly(async (tx) => {
      const companyReader = {
        ...tx.company,
        createMany: async () => ({ count: 0 }),
        findFirst: tx.company.findFirst.bind(tx.company),
        findUniqueOrThrow: tx.company.findUniqueOrThrow.bind(tx.company),
      };
      const forbidden = new Proxy(
        {},
        {
          get: () => () => {
            throw new Error('Forbidden network/acquisition');
          },
        },
      );
      return new CompanyService(forbidden, forbidden, {
        company: companyReader,
      }).getCompany(company.cik);
    });
    for (const [kind, storedRows] of [
      ['annual', company.annualFinancials],
      ['quarterly', company.quarterlyFinancials],
    ]) {
      const rows = detail[kind];
      assert.equal(rows.length, 10);
      for (const row of rows) {
        const stored = storedRows.find(
          (r) => date(r.periodEnd) === row.periodEnd,
        );
        for (const k of FINANCIAL_METRICS) assert.equal(row[k], num(stored[k]));
      }
      const html = renderToStaticMarkup(
        createElement(FinancialAnalysis, { detail, mode: kind }),
      );
      const $ = load(html);
      for (const card of $('[data-metric].analysis-metric-card').toArray()) {
        const k = $(card).attr('data-metric');
        const metric = METRICS[k];
        assert.equal(
          $(card).find('.ant-statistic-content').text(),
          formatAnalysisValue(analysisValue(rows[0], k, kind), metric.unit),
        );
      }
      assert.equal($('[data-analysis-module]').length, 4);
      fs.writeFileSync(
        path.join(directory, `${company.cik}-${kind}-render.html`),
        html,
      );
    }
    // Real cached periods in every series: gaps/nulls remain empty SVG positions, true zeros remain points.
    let chartsChecked = 0;
    for (const [key, unit] of [
      ['revenue', 'money'],
      ['revenueGrowth', 'percent'],
      ['epsGrowth', 'percent'],
      ['grossMargin', 'percent'],
      ['operatingMargin', 'percent'],
      ['netMargin', 'percent'],
      ['operatingCashFlow', 'money'],
      ['capex', 'money'],
      ['fcf', 'money'],
      ['cash', 'money'],
      ['marketableSecurities', 'money'],
      ['totalDebt', 'money'],
      ['stockRepurchases', 'money'],
      ['dilutedShares', 'shares'],
      ['dividendsPerShare', 'perShare'],
    ]) {
      const rows = [...detail.quarterly].sort((a, b) =>
        a.periodEnd.localeCompare(b.periodEnd),
      );
      const $ = load(
        renderToStaticMarkup(
          createElement(FinancialTrendChart, {
            rows,
            mode: 'quarterly',
            series: [{ key, label: key, color: '#1677ff' }],
            unit,
            title: key,
          }),
        ),
      );
      assert.equal(
        $('circle').length,
        rows.filter((r) => analysisValue(r, key, 'quarterly') !== null).length,
      );
      const dataLines = $('line').filter(
        (_, e) => $(e).attr('stroke') === '#1677ff',
      );
      const expected = rows
        .slice(1)
        .filter(
          (r, i) =>
            r[key] != null &&
            rows[i][key] != null &&
            day(rows[i].periodEnd, r.periodEnd) <= 121,
        ).length;
      assert.equal(dataLines.length, expected);
      const positions = $('circle')
        .toArray()
        .map((e) => Number($(e).attr('cx')));
      assert.ok(positions.every((x, i) => i === 0 || x > positions[i - 1]));
      chartsChecked++;
    }
    assert.equal(provenanceFailures.length, 0);
    assert.equal(periodFailures.length, 0);
    assert.equal(formulaFailures.length, 0);
    output.companies.push({
      cik: company.cik,
      ticker: company.ticker,
      cacheLastFetchedAt: company.lastFetchedAt,
      sourceFileHash: hash(raw),
      sourceFileModifiedAt: fs.statSync(file).mtime.toISOString(),
      annualCount: company.annualFinancials.length,
      quarterCount: company.quarterlyFinancials.length,
      sourceOccurrences,
      yoyChecks,
      provenanceFailures,
      periodFailures,
      formulaFailures,
      cacheDifferences,
      crosschecks,
      epsComparisons,
      quarterSummary,
      chartsChecked,
      apiSerializationAndReactMatch: true,
      latestSources: company.quarterlyFinancials[0].sources,
      normalizedLatestShareholderSources: Object.fromEntries(
        [
          'dilutedShares',
          'dilutedSharesGrowth',
          'dividendsPerShare',
          'dpsGrowth',
        ].map((key) => [key, normalized.quarterly[0].sources[key] ?? null]),
      ),
      capexCoverage: Object.fromEntries(
        [
          'PaymentsToAcquirePropertyPlantAndEquipment',
          'PaymentsToAcquireProductiveAssets',
        ].map((tag) => [
          tag,
          {
            definition: raw.facts['us-gaap'][tag]?.description ?? null,
            currentYearFacts: (
              raw.facts['us-gaap'][tag]?.units.USD ?? []
            ).filter(
              (f) =>
                f.end === normalized.quarterly[0].periodEnd ||
                f.end === normalized.quarterly[1].periodEnd,
            ),
          },
        ]),
      ),
    });
  }
  const after = await readonly(snapshot);
  assert.equal(
    hash(before),
    hash(after),
    'audited cache, AI summaries and tasks must remain unchanged',
  );
  output.databaseUnchanged = true;
  output.databaseFingerprint = hash(before);
  const out =
    process.env.QUARTERLY_AUDIT_OUTPUT ||
    'docs/validation/quarterly-financial-audit-evidence.json';
  fs.writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        output: out,
        databaseUnchanged: true,
        companies: output.companies.map((c) => ({
          ticker: c.ticker,
          sourceOccurrences: c.sourceOccurrences,
          cacheDifferences: c.cacheDifferences.length,
          crosschecks: c.crosschecks.length,
          charts: c.chartsChecked,
        })),
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
