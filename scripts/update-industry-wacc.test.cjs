const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWacc } = require('./update-industry-wacc.cjs');
const snapshot = require('../apps/web/src/data/industry-wacc-us.json');
test('official local snapshot contains only industry Cost of Capital and provenance, with unique valid rates', () => {
  assert.equal(snapshot.field, 'Cost of Capital');
  assert.equal(snapshot.region, 'US');
  assert.equal(snapshot.currency, 'USD');
  assert.match(snapshot.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.ok(snapshot.industries.length >= 50);
  assert.equal(
    snapshot.nonFinancialMarket.name,
    'Total Market (without financials)',
  );
  assert.ok(
    snapshot.nonFinancialMarket.wacc > 0 &&
      snapshot.nonFinancialMarket.wacc < 1,
  );
  assert.ok(
    !snapshot.industries.some(
      (x) => x.name === snapshot.nonFinancialMarket.name,
    ),
  );
  assert.equal(
    new Set(snapshot.industries.map((x) => x.name)).size,
    snapshot.industries.length,
  );
  for (const row of snapshot.industries) {
    assert.deepEqual(Object.keys(row).sort(), ['costOfEquity', 'name', 'wacc']);
    assert.ok(row.costOfEquity > 0 && row.costOfEquity < 1);
    assert.ok(row.wacc > 0 && row.wacc < 1);
  }
});
test('invalid spreadsheets are rejected, rather than replacing official data with an empty snapshot', () => {
  assert.throws(() => parseWacc(Buffer.from('not an official workbook')));
});
