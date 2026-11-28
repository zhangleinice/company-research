const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../../../apps/api/tests/fixtures/financial-evidence/ocf-fcff-coverage.json');
test('all ten sampled companies are represented, and standard/raw-supplement coverage stays separate', () => {
  assert.equal(d.companies.length, 10);
  assert.equal(d.companyFactsFCFCount, 9);
  assert.equal(d.supplementedFCFCount, 10);
  assert.equal(d.approvedFCFFCount, 0);
});
test('every FCF is computed from matching USD periods with signed negative FCF retained', () => {
  for (const c of d.companies) {
    if (c.fcf === null) continue;
    assert.equal(c.ocf.start, c.capex.start);
    assert.equal(c.ocf.end, c.capex.end);
    assert.equal(c.fcf, c.ocf.value - c.capex.value);
    assert.ok(c.ocf.items.concat(c.capex.items).every((f) => f.unit === 'USD'));
  }
  assert.equal(d.companies.find((c) => c.ticker === 'AMZN').fcf, -46892000000);
});
test('broader capex is accepted only with actual filing table evidence and scope', () => {
  for (const t of ['AMZN', 'NVDA']) {
    const c = d.companies.find((c) => c.ticker === t);
    assert.ok(c.alternative.originalTable.source);
    assert.ok(
      c.alternative.originalTable.concept.endsWith(
        '}PaymentsToAcquireProductiveAssets',
      ),
    );
    assert.equal(
      Number(c.alternative.originalTable.value),
      c.capex.items[1].val,
    );
  }
});
test('interest expense, paid interest and tax shield assumptions are never silently interchanged', () => {
  for (const c of d.companies) {
    assert.equal(c.interestPaid, null);
    assert.equal(c.taxShieldRate, null);
    assert.equal(c.simplifiedFCFF, null);
    if (c.historicalEffectiveTaxRate !== null)
      assert.equal(c.historicalEffectiveTaxRate, c.tax.value / c.pretax.value);
  }
});
test('XOM standard current facts remain null while the separately traced raw-filing supplement can be computed', () => {
  const x = d.companies.find((c) => c.ticker === 'XOM');
  assert.equal(x.fcf, null);
  assert.equal(x.ocf, null);
  assert.equal(x.capex, null);
  assert.equal(x.supplement.fcf, 30553000000);
  assert.equal(x.supplement.end, undefined);
  assert.equal(x.supplement.ocf.end, '2026-06-30');
});
