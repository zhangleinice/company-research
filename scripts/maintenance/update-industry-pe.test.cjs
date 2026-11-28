const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  XLSX = require('xlsx'),
  { parsePe } = require('./update-industry-pe.cjs');
const snapshot = require('../../apps/web/src/data/industry-pe-us.json');
test('snapshot retains profitable-firm aggregate trailing PE, provenance and no forward estimates', () => {
  assert.equal(snapshot.region, 'US');
  assert.equal(
    snapshot.field,
    'Aggregate Mkt Cap/ Trailing Net Income (only money making firms)',
  );
  assert.match(snapshot.sha256, /^[0-9a-f]{64}$/);
  assert.ok(snapshot.industries.length >= 50);
  for (const x of snapshot.industries) {
    assert.deepEqual(Object.keys(x).sort(), ['name', 'pe']);
    assert.ok(x.pe === null || x.pe > 0);
  }
  assert.ok(
    !snapshot.industries.some((x) => x.name.startsWith('Total Market')),
  );
});
test('parser selects exact aggregate field, preserves NA, rejects wrong region/headers', () => {
  const rows = [
    ['Date updated:', 46027],
    ['US companies'],
    ['Industry Name', 'Number of firms', 'Forward PE', snapshot.field],
    ...Array.from({ length: 50 }, (_, i) => [
      'Sector ' + i,
      10,
      99,
      i === 0 ? 'NA' : 20,
    ]),
  ];
  function bytes() {
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      w,
      XLSX.utils.aoa_to_sheet(rows),
      'Industry Averages',
    );
    return XLSX.write(w, { type: 'buffer', bookType: 'xls' });
  }
  const d = parsePe(bytes());
  assert.equal(d.industries[0].pe, null);
  assert.equal(d.industries[1].pe, 20);
  rows[2][3] = 'Trailing PE';
  assert.throws(() => parsePe(bytes()));
  rows[2][3] = snapshot.field;
  rows[1][0] = 'Global companies';
  assert.throws(() => parsePe(bytes()));
});
