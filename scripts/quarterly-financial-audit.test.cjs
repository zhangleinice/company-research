const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  normalizeCompanyFacts,
} = require('../apps/api/dist/modules/financials/normalize-company-facts');
const directory =
  process.env.QUARTERLY_AUDIT_CACHE || '/tmp/quarterly-financial-audit';
function fiscalFixture(start, ends, fy) {
  const taxonomy = {};
  const add = (concept, unit, value) => {
    ((taxonomy[concept] ??= { units: {} }).units[unit] ??= []).push(value);
  };
  const shift = (d) =>
    new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
  ends.forEach((end, i) => {
    const annual = i === 3;
    const common = {
      end,
      fy,
      fp: annual ? 'FY' : `Q${i + 1}`,
      form: annual ? '10-K' : '10-Q',
      filed: shift(end),
      accn: `filing-${i}`,
    };
    add('Revenues', 'USD', {
      ...common,
      start: annual ? start : i ? shift(ends[i - 1]) : start,
      val: annual ? 200 : [20, 40, 60][i],
    });
    if (i > 0 && !annual)
      add('Revenues', 'USD', { ...common, start, val: [20, 60, 120][i] });
    add('NetCashProvidedByUsedInOperatingActivities', 'USD', {
      ...common,
      start,
      val: [10, 30, 60, 100][i],
    });
    add('PaymentsToAcquirePropertyPlantAndEquipment', 'USD', {
      ...common,
      start,
      val: [2, 5, 9, 14][i],
    });
    if (!annual)
      add('EarningsPerShareDiluted', 'USD/shares', {
        ...common,
        start: i ? shift(ends[i - 1]) : start,
        val: i + 1,
      });
  });
  return { cik: 1, facts: { 'us-gaap': taxonomy } };
}
for (const [weeks, start, ends, fy] of [
  [
    53,
    '2023-10-01',
    ['2023-12-30', '2024-03-30', '2024-06-29', '2024-10-05'],
    2024,
  ],
  [
    52,
    '2024-10-06',
    ['2025-01-04', '2025-04-05', '2025-07-05', '2025-10-04'],
    2025,
  ],
])
  test(`${weeks}-week non-calendar fiscal year keeps correct quarter labels, YTD differences and nonadditive nulls`, () => {
    const rows = normalizeCompanyFacts(
      fiscalFixture(start, ends, fy),
    ).quarterly.reverse();
    assert.deepEqual(
      rows.map((r) => r.fiscalQuarter),
      [1, 2, 3, 4],
    );
    assert.ok(rows.every((r) => r.fiscalYear === fy));
    assert.deepEqual(
      rows.map((r) => r.revenue),
      [20, 40, 60, 80],
    );
    assert.deepEqual(
      rows.map((r) => r.operatingCashFlow),
      [10, 20, 30, 40],
    );
    assert.deepEqual(
      rows.map((r) => r.capex),
      [2, 3, 4, 5],
    );
    assert.deepEqual(
      rows.map((r) => r.eps),
      [1, 2, 3, null],
    );
    assert.ok(rows.every((r) => r.roe === null));
  });
const nvdaFile = `${directory}/0001045810-companyfacts.json`;
test(
  'suppresses the observed NVDA mixed split-basis EPS YoY without changing the displayed EPS',
  { skip: !fs.existsSync(nvdaFile) },
  () => {
    const raw = JSON.parse(fs.readFileSync(nvdaFile));
    const facts =
      raw.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'];
    const row = normalizeCompanyFacts(raw).quarterly.find(
      (r) => r.periodEnd === '2024-04-28',
    );
    const sameFiling = facts.filter(
      (f) =>
        f.accn === '0001045810-24-000124' &&
        f.end === '2024-04-28' &&
        f.start === '2024-01-29',
    )[0];
    const old = facts.filter(
      (f) =>
        f.accn === sameFiling.accn &&
        f.end === '2023-04-30' &&
        f.start === '2023-01-30',
    )[0];
    assert.equal(row.eps, 0.6);
    assert.equal(row.epsGrowth, null);
    assert.equal(sameFiling.val, 5.98);
    assert.equal(old.val, 0.82);
    const comparable = (sameFiling.val / old.val - 1) * 100;
    assert.ok(Math.abs(comparable - 629.2682926829268) < 1e-8);
    assert.notEqual(row.epsGrowth, comparable);
  },
);
