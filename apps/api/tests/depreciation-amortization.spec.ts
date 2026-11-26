import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  depreciationAmortization,
  ownerDepreciationFact,
  storedAnnualDepreciation,
} from '../src/modules/financials/depreciation-amortization';
import { extractDepreciationDisclosures } from '../src/modules/financials/depreciation-disclosure';
import type { ValuationFact } from '@company-research/shared';
import type { DebtFiling } from '../src/modules/financials/debt-disclosure';
const cik = '0000000001',
  accn = '0000000001-26-000001';
const fact = (
  start = '2025-01-01',
  end = '2025-12-31',
  val = 100,
  accession = accn,
) => ({
  start,
  end,
  val,
  accn: accession,
  filed: '2026-11-01',
  form: end.endsWith('12-31') ? '10-K' : '10-Q',
});
const ocf = (
  items = [fact()],
  start = items[0].start,
  end = items[0].end,
  value = items[0].val,
): ValuationFact => ({
  start,
  end,
  value,
  concept: 'us-gaap:NetCashProvidedByUsedInOperatingActivities',
  items: items.map((x) => ({
    ...x,
    unit: 'USD',
    concept: 'us-gaap:NetCashProvidedByUsedInOperatingActivities',
  })),
});
const raw = (entries: Record<string, ReturnType<typeof fact>[]>) => ({
  cik,
  facts: {
    'us-gaap': Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, { units: { USD: v } }]),
    ),
  },
});
it('prefers a complete total without adding components; zero differs from missing', () => {
  const r = raw({
    DepreciationDepletionAndAmortization: [fact(undefined, undefined, 30)],
    Depreciation: [fact(undefined, undefined, 25)],
    AmortizationOfIntangibleAssets: [fact(undefined, undefined, 5)],
  });
  const d = depreciationAmortization(r, cik, ocf());
  expect(d.value).toBe(30);
  expect(d.items).toHaveLength(1);
  expect(d.concept).toBe('us-gaap:DepreciationDepletionAndAmortization');
  r.facts['us-gaap'].DepreciationDepletionAndAmortization.units.USD[0].val = 0;
  expect(depreciationAmortization(r, cik, ocf()).value).toBe(0);
  expect(depreciationAmortization(raw({}), cik, ocf()).value).toBeNull();
});
it('only sums complete disjoint standard components from the OCF filing and retains approximation metadata', () => {
  const r = raw({
    Depreciation: [fact(undefined, undefined, 25)],
    AmortizationOfIntangibleAssets: [fact(undefined, undefined, 5)],
  });
  const d = depreciationAmortization(r, cik, ocf());
  expect(d.value).toBe(30);
  expect(d.approximate).toBe(true);
  expect(d.items.map((x) => x.coefficient)).toEqual([1, 1]);
  expect(d.calculation).toContain('AmortizationOfIntangibleAssets');
  const persisted = ownerDepreciationFact(d);
  const source = {
    ...fact(),
    unit: 'USD' as const,
    concept: 'us-gaap:NetCashProvidedByUsedInOperatingActivities',
    url: 'https://www.sec.gov',
  };
  expect(
    storedAnnualDepreciation(persisted, '2025-01-01', '2025-12-31', source)
      ?.value,
  ).toBe(30);
  persisted.sources[1].val = 6;
  expect(
    storedAnnualDepreciation(persisted, '2025-01-01', '2025-12-31', source),
  ).toBeNull();
  r.facts['us-gaap'].AmortizationOfIntangibleAssets.units.USD[0].accn = 'other';
  expect(depreciationAmortization(r, cik, ocf()).value).toBeNull();
});
it('never substitutes depreciation, lease amortization, Other, accretion, or a conflicting total', () => {
  const r = raw({
    Depreciation: [fact()],
    FinanceLeaseRightOfUseAssetAmortization: [fact()],
    DepreciationAmortizationAndOther: [fact()],
    DepreciationAmortizationAndAccretionNet: [fact()],
  });
  expect(depreciationAmortization(r, cik, ocf()).value).toBeNull();
  Object.assign(r.facts['us-gaap'], {
    DepreciationAndAmortization: {
      units: {
        USD: [fact(undefined, undefined, 30), fact(undefined, undefined, 31)],
      },
    },
    AmortizationOfIntangibleAssets: {
      units: { USD: [fact(undefined, undefined, 5)] },
    },
  });
  expect(depreciationAmortization(r, cik, ocf()).value).toBeNull();
});
it('derives independent Q2/Q3/Q4 and TTM on the existing cumulative source chain, never treats YTD as a quarter', () => {
  const y = fact('2025-01-01', '2025-12-31', 120),
    q = fact('2026-01-01', '2026-09-30', 150),
    p = fact('2025-01-01', '2025-09-30', 90),
    h = fact('2025-01-01', '2025-06-30', 50);
  const first = fact('2025-01-01', '2025-03-31', 20);
  const r = raw({ DepreciationAndAmortization: [y, q, p, h, first] });
  expect(
    depreciationAmortization(r, cik, ocf([h, first], '2025-04-01', h.end, 30))
      .value,
  ).toBe(30);
  expect(
    depreciationAmortization(r, cik, ocf([p, h], '2025-07-01', p.end, 40))
      .value,
  ).toBe(40);
  expect(
    depreciationAmortization(r, cik, ocf([y, p], '2025-10-01', y.end, 30))
      .value,
  ).toBe(30);
  const d = depreciationAmortization(
    r,
    cik,
    ocf([y, q, p], '2025-10-01', q.end, 180),
  );
  expect(d.value).toBe(180);
  expect(d.items.map((x) => x.coefficient)).toEqual([1, 1, -1]);
  expect(
    depreciationAmortization(r, cik, ocf([p], '2025-07-01', p.end, 90)).value,
  ).toBeNull();
  expect(
    depreciationAmortization(r, cik, { ...ocf(), start: 'invalid' }).value,
  ).toBeNull();
});
it('rejects source-period, currency, dimension and sign conflicts', () => {
  const r = raw({
    DepreciationAndAmortization: [fact(undefined, undefined, -1)],
  });
  expect(depreciationAmortization(r, cik, ocf()).value).toBeNull();
  const a = fact('2025-01-01', '2025-06-30', 10),
    b = fact('2025-01-01', '2025-03-31', 20);
  expect(
    depreciationAmortization(
      raw({ DepreciationAndAmortization: [a, b] }),
      cik,
      ocf([a, b], '2025-04-01', a.end, -10),
    ).value,
  ).toBeNull();
  const c = raw({ DepreciationAndAmortization: [fact()] });
  Object.assign(c.facts['us-gaap'].DepreciationAndAmortization.units.USD[0], {
    segment: {},
  });
  expect(depreciationAmortization(c, cik, ocf()).value).toBeNull();
  expect(
    depreciationAmortization(raw({}), '0000000002', ocf()).value,
  ).toBeNull();
});
const directory = join(__dirname, 'fixtures/debt-filings');
const manifest = JSON.parse(
  readFileSync(join(directory, 'manifest.json'), 'utf8'),
) as (DebtFiling & { file: string; ticker: string })[];
it('uses actual MSFT rounded note components, not Depreciation Amortization and Other', () => {
  const m = manifest.find(
    (x) => x.ticker === 'MSFT' && x.reportDate === '2026-06-30',
  )!;
  const supplemental = extractDepreciationDisclosures(
    gunzipSync(readFileSync(join(directory, m.file))).toString(),
    m,
  );
  const leg = {
    ...fact('2025-07-01', '2026-06-30', 182935e6, m.accessionNumber),
    filed: m.filingDate,
    form: '10-K',
  };
  const d = depreciationAmortization(
    { cik: m.cik, facts: { 'us-gaap': {} } },
    m.cik,
    ocf([leg]),
    supplemental,
  );
  expect(d.value).toBe(39000e6);
  expect(d.approximate).toBe(true);
  expect(d.items.map((x) => x.decimals)).toEqual([-8, -8]);
  expect(d.items.some((x) => String(x.concept).includes('Other'))).toBe(false);
  expect(d.items.every((x) => String(x.evidence).includes('SHA256'))).toBe(
    true,
  );
  expect(() =>
    extractDepreciationDisclosures(
      gunzipSync(readFileSync(join(directory, m.file))).toString(),
      { ...m, cik: '0000000001' },
    ),
  ).toThrow();
});
it('keeps GOOGL annual missing when the filing supplies no complete intangible amortization', () => {
  const m = manifest.find(
    (x) => x.ticker === 'GOOGL' && x.reportDate === '2025-12-31',
  )!;
  const supplemental = extractDepreciationDisclosures(
    gunzipSync(readFileSync(join(directory, m.file))).toString(),
    m,
  );
  expect(supplemental.some((x) => x.kind === 'amortization')).toBe(false);
});

it('supplement rejects non-USD and dimensional facts rather than admitting note subtotals', () => {
  const m = manifest.find(
    (x) => x.ticker === 'MSFT' && x.reportDate === '2026-06-30',
  )!;
  const html = gunzipSync(readFileSync(join(directory, m.file))).toString();
  const $ = load(html, { xmlMode: true });
  const nodes = $('*')
    .toArray()
    .filter((n) => n.type === 'tag');
  for (const n of nodes)
    if (n.type === 'tag' && n.attribs.name?.endsWith(':Depreciation'))
      $(n).attr('unitRef', 'not-usd');
  const disclosures = extractDepreciationDisclosures($.xml(), m);
  expect(disclosures.some((x) => x.kind === 'depreciation')).toBe(false);
  const $$ = load(html, { xmlMode: true });
  for (const n of $$('*').toArray())
    if (n.type === 'tag' && n.name.endsWith(':context'))
      $$(n).append(
        '<xbrldi:explicitMember dimension="test:Scope">test:Segment</xbrldi:explicitMember>',
      );
  expect(extractDepreciationDisclosures($$.xml(), m)).toHaveLength(0);
});
it('accepts a pure issuer D&A cash-flow line and rejects its mixed Other variant', () => {
  const filing = {
    cik,
    accessionNumber: accn,
    reportDate: '2025-12-31',
    filingDate: '2026-11-01',
    sourceUrl:
      'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/report.htm',
  };
  const html = `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance"
    xmlns:dei="http://xbrl.sec.gov/dei/2026" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
    xmlns:us-gaap="http://fasb.org/us-gaap/2026" xmlns:issuer="http://example.com/2026"><body>
    <ix:nonNumeric name="dei:DocumentType">10-K</ix:nonNumeric>
    <ix:nonNumeric name="dei:DocumentPeriodEndDate">2025-12-31</ix:nonNumeric>
    <xbrli:context id="year"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="USD"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
    <table><tr><td>Depreciation and amortization</td><td><ix:nonFraction name="issuer:DepreciationAndAmortization" contextRef="year" unitRef="USD" decimals="0">30</ix:nonFraction></td></tr>
    <tr><td>Operating cash flow</td><td><ix:nonFraction name="us-gaap:NetCashProvidedByUsedInOperatingActivities" contextRef="year" unitRef="USD" decimals="0">100</ix:nonFraction></td></tr></table></body></html>`;
  const extras = extractDepreciationDisclosures(html, filing);
  expect(depreciationAmortization(raw({}), cik, ocf(), extras).value).toBe(30);
  expect(
    extractDepreciationDisclosures(
      html.replaceAll(
        'DepreciationAndAmortization',
        'DepreciationAmortizationAndOther',
      ),
      filing,
    ),
  ).toHaveLength(0);
});
