/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS tools reuse the compiled NestJS SEC client. */
/* global require */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { amount, inspect } = require('./parser.cjs');
const meta = {
  cik: '0001652044',
  accessionNumber: '0001652044-26-000018',
  reportDate: '2025-12-31',
  sourceUrl:
    'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/test.htm',
};
function html(
  extra = '',
  period = '<xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate>',
) {
  return `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:g="http://fasb.org/us-gaap/2025" xmlns:c="http://issuer.example/2025" xmlns:iso="http://www.xbrl.org/2003/iso4217"><xbrli:context id="c"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1652044</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="g:StatementBusinessSegmentsAxis">c:OfficialMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context><xbrli:unit id="u"><xbrli:measure>iso:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="g:Revenues" contextRef="c" unitRef="u" scale="6">1,234</ix:nonFraction>${extra}</html>`;
}
test('exact integer amounts, transformations, no guessed dash or locale values', () => {
  assert.equal(amount('1,234', '6'), '1234000000');
  assert.equal(amount('1.25', '6', '-'), '-1250000');
  assert.throws(() => amount('—', '6'));
  assert.throws(() => amount('1.234,56', '0'));
  assert.throws(() =>
    amount('2', '6', undefined, '{https://malicious/}num-dot-decimal'),
  );
});
test('namespace-resolved concepts and member tuples, provenance and no production approval', () => {
  const r = inspect(html(), meta);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].value, '1234000000');
  assert.equal(r.productionApproved, 0);
  assert.equal(r.candidates[0].accessionNumber, meta.accessionNumber);
  assert.equal(
    r.candidates[0].context.dimensions[0].member,
    '{http://issuer.example/2025}OfficialMember',
  );
  assert.equal(
    inspect(
      html().replace('http://fasb.org/us-gaap/2025', 'https://malicious/'),
      meta,
    ).candidates.length,
    0,
  );
});
test('rejects wrong filing identity, units, CIK and quarterly periods', () => {
  assert.throws(() =>
    inspect(html(), { ...meta, accessionNumber: '0001652044-25-000001' }),
  );
  assert.equal(
    inspect(html().replace('iso:USD', 'iso:EUR'), meta).candidates.length,
    0,
  );
  assert.equal(
    inspect(html().replace('>1652044<', '>12345<'), meta).candidates.length,
    0,
  );
  assert.equal(
    inspect(
      html(
        '',
        '<xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate>',
      ),
      meta,
    ).candidates.length,
    0,
  );
});
test('deduplicates semantic facts but quarantines conflicting amounts', () => {
  const fact =
    '<ix:nonFraction name="g:Revenues" contextRef="c" unitRef="u" scale="6">1,234</ix:nonFraction>';
  assert.equal(inspect(html(fact), meta).duplicates, 1);
  const r = inspect(html(fact.replace('1,234', '1,235')), meta);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.candidates[0].status, 'CONFLICT');
});
test('missing contexts, unresolved formats and invalid dates do not become facts', () => {
  assert.equal(
    inspect(html().replace('contextRef="c"', 'contextRef="unknown"'), meta)
      .candidates.length,
    0,
  );
  assert.equal(
    inspect(
      html().replace('scale="6"', 'scale="6" format="unknown:num-dot-decimal"'),
      meta,
    ).candidates.length,
    0,
  );
  assert.equal(
    inspect(html().replace('2025-01-01', '2025-02-30'), meta).candidates.length,
    0,
  );
});
