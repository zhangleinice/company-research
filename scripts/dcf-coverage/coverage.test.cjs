const { test } = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../../docs/validation/dcf-companyfacts-coverage.json');
test('all ten real companies have a latest filing anchor; historical presence does not imply availability', () => {
  assert.equal(evidence.companies.length, 10);
  const xom = evidence.companies.find((c) => c.ticker === 'XOM');
  assert.equal(xom.filing.end, '2026-06-30');
  assert.equal(xom.metrics.CapEx.status, '缺失');
  assert.equal(xom.metrics.CapEx.value, null);
  assert.ok(xom.metrics.CapEx.attempts.some((a) => a.historical));
});
test('every approved flow uses coherent latest endpoints and reproduces FY+YTD-prior YTD', () => {
  for (const c of evidence.companies)
    for (const k of ['Revenue', 'EBIT', 'Tax', 'DA', 'CapEx', 'OCF']) {
      const r = c.metrics[k].calculation;
      if (!r) continue;
      assert.equal(r.end, c.filing.end);
      assert.ok(
        r.items.every((f) => f.unit === 'USD' && f.filed <= c.filing.filed),
      );
      assert.equal(new Set(r.items.map((f) => f.concept)).size, 1);
      if (r.method === 'annual_is_TTM') {
        assert.equal(r.value, r.items[0].val);
        assert.equal(r.items[0].accn, c.filing.accn);
      } else {
        const [fy, now, prior] = r.items;
        assert.equal(r.value, fy.val + now.val - prior.val);
        assert.equal(now.accn, c.filing.accn);
        assert.equal(prior.accn, now.accn);
        assert.equal(prior.start, fy.start);
        assert.equal(
          new Date(Date.parse(fy.end) + 86400000).toISOString().slice(0, 10),
          now.start,
        );
      }
    }
});
test('unapproved D&A, broader CapEx and undefined operating NWC remain null', () => {
  for (const c of evidence.companies) {
    assert.equal(c.metrics.DeltaNWC.value, null);
    for (const m of Object.values(c.metrics))
      if (m.status !== '可用') assert.equal(m.value, null);
  }
  for (const t of ['AMZN', 'NVDA'])
    assert.equal(
      evidence.companies.find((c) => c.ticker === t).metrics.CapEx.status,
      '部分可用',
    );
});
test('point-in-time data are not TTM and preserve true zeros in raw sources', () => {
  for (const c of evidence.companies)
    for (const k of ['Cash', 'Investments', 'ShortDebt', 'LongDebt'])
      for (const f of c.metrics[k].items) {
        assert.equal(f.start, undefined);
        assert.equal(f.end, c.filing.end);
        assert.equal(f.accn, c.filing.accn);
        assert.equal(f.unit, 'USD');
      }
  const google = evidence.companies.find((c) => c.ticker === 'GOOGL');
  assert.ok(google.metrics.ShortDebt.items.some((f) => f.val === 0));
});
test('coverage counts exactly match approved/partial/missing decisions', () => {
  for (const [k, v] of Object.entries(evidence.coverage)) {
    assert.equal(v.available + v.partial + v.missing, 10);
    assert.equal(
      v.available,
      evidence.companies.filter((c) => c.metrics[k].status === '可用').length,
    );
  }
});
