/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS validation. */
/* global require */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { extractTables, comparable } = require('./table-core.cjs');
const meta = {
  cik: '0001652044',
  accessionNumber: '0001652044-26-000018',
  reportDate: '2025-12-31',
  fiscalYear: 2025,
  sourceUrl:
    'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/test.htm',
};
function fixture(label = 'Official Service (1)', mixed = false) {
  const contexts = [2023, 2024, 2025]
    .map(
      (y) =>
        `<x:context id="c${y}"><x:entity><x:identifier scheme="http://www.sec.gov/CIK">1652044</x:identifier><x:segment><d:explicitMember dimension="s:ProductOrServiceAxis">issuer:${mixed && y === 2024 ? 'Different' : 'Official'}Member</d:explicitMember></x:segment></x:entity><x:period><x:startDate>${y}-01-01</x:startDate><x:endDate>${y}-12-31</x:endDate></x:period></x:context>`,
    )
    .join('');
  const fact = (year, value) =>
    `<i:nonFraction id="v${year}" contextRef="c${year}" unitRef="u" name="g:Revenues" scale="6">${value}</i:nonFraction>`;
  return `<html xmlns:x="http://www.xbrl.org/2003/instance" xmlns:d="http://xbrl.org/2006/xbrldi" xmlns:i="http://www.xbrl.org/2013/inlineXBRL" xmlns:g="http://fasb.org/us-gaap/2025" xmlns:s="http://fasb.org/srt/2025" xmlns:issuer="http://example.com/2025" xmlns:iso="http://www.xbrl.org/2003/iso4217">${contexts}<x:unit id="u"><x:measure>iso:USD</x:measure></x:unit><table><tr><th></th><th>2023</th><th>2024</th><th>2025</th></tr><tr><td>${label}</td><td>${fact(2023, 100)}</td><td>${fact(2024, 120)}</td><td>${fact(2025, 150)}</td></tr></table></html>`;
}
test('preserves official label, group/order, three years, original facts and same-row YoY without company-name rules', () => {
  const r = extractTables(fixture(), meta);
  assert.equal(r.groups.length, 1);
  const row = r.groups[0].rows[0];
  assert.equal(row.name, 'Official Service (1)');
  assert.deepEqual(
    row.facts.map((f) => f.value),
    ['100000000', '120000000', '150000000'],
  );
  assert.deepEqual(
    row.facts.map((f) => f.fiscalYear),
    [2023, 2024, 2025],
  );
  assert.equal(row.facts[0].yoy.value, null);
  assert.equal(row.facts[1].yoy.value, 20);
  assert.equal(row.facts[2].yoy.value, 25);
});
test('mixed member rows are skipped rather than renamed or compared', () => {
  const r = extractTables(fixture('Revenue', true), meta);
  assert.equal(r.groups.length, 0);
  assert.ok(r.skips.some((s) => s.reason.includes('mixed concepts')));
});
test('cannot compare missing years, zero bases, different tuples or nonannual date offsets', () => {
  const facts = extractTables(fixture(), meta).groups[0].rows[0].facts;
  assert.equal(comparable(facts[2], facts[0]).value, null);
  assert.equal(comparable(facts[2], { ...facts[1], value: '0' }).value, null);
  assert.equal(comparable(facts[2], { ...facts[1], unit: 'EUR' }).value, null);
});
for (const company of ['alphabet', 'apple', 'nvidia'])
  test(`${company}: cached filing rows retain source identity, amount/period pairing, total/adjustment names`, () => {
    const d = '/tmp/revenue-breakdown-validation/' + company;
    const r = extractTables(
      fs.readFileSync(d + '/filing.htm', 'utf8'),
      JSON.parse(fs.readFileSync(d + '/metadata.json')),
    );
    assert.ok(r.groups.length);
    for (const group of r.groups) {
      assert.deepEqual(
        group.rows.map((x) => x.rowIndex),
        group.rows.map((x) => x.rowIndex).sort((a, b) => a - b),
      );
      for (const row of group.rows) {
        assert.ok(row.name);
        for (const f of row.facts) {
          assert.equal(f.accessionNumber, r.metadata.accessionNumber);
          assert.equal(f.unit, 'USD');
          assert.equal(f.sourcePosition.tableIndex, group.tableIndex);
          assert.equal(f.sourcePosition.rowIndex, row.rowIndex);
        }
      }
    }
    const rows = r.groups.flatMap((g) => g.rows);
    const expected =
      company === 'alphabet'
        ? [
            'Google Services',
            'Google Cloud',
            'Other Bets',
            'Hedging gains (losses)',
            'Total revenues',
          ]
        : company === 'apple'
          ? ['iPhone', 'Mac', 'iPad', 'Services (1)', 'Total net sales']
          : ['Data Center', 'Compute', 'Networking', 'Total revenue'];
    for (const name of expected)
      assert.ok(
        rows.some((row) => row.name === name),
        name,
      );
    if (company === 'alphabet')
      assert.ok(
        rows
          .find((row) => row.name === 'Hedging gains (losses)')
          .facts.some((f) => f.value === '-127000000'),
      );
    if (company === 'apple')
      assert.ok(!rows.some((row) => row.name === 'Net sales'));
    if (company === 'nvidia')
      assert.ok(!rows.some((row) => row.name === 'Revenue'));
  });
