import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  extractDebtDisclosures,
  type DebtFiling,
} from '../src/modules/financials/debt-disclosure';
import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
import { SecService } from '../src/modules/sec/sec.service';
import type { BalanceSheetInputs } from '@company-research/shared';
const directory = join(__dirname, 'fixtures/debt-filings');
const manifest = JSON.parse(
  readFileSync(join(directory, 'manifest.json'), 'utf8'),
) as (DebtFiling & { file: string; sha256: string; ticker: string })[];
const facts = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/balance-sheet-regression.json'),
    'utf8',
  ),
);
const extracted = manifest.map((m) => {
  const html = gunzipSync(readFileSync(join(directory, m.file))).toString();
  if (createHash('sha256').update(html).digest('hex') !== m.sha256)
    throw Error('SEC fixture checksum mismatch');
  return { metadata: m, html, disclosures: extractDebtDisclosures(html, m) };
});
const forCompany = (t: string) =>
  extracted
    .filter((x) => x.metadata.ticker === t)
    .flatMap((x) => x.disclosures);
const rows = (t: string) =>
  normalizeCompanyFacts(facts[t].raw, forCompany(t)).annual;
const inputs = (row: ReturnType<typeof rows>[number]) =>
  row.sources.balanceSheetInputs as BalanceSheetInputs;
it.each([
  ['AAPL', '2026-09-26', 80111, 81567, 1456],
  ['AAPL', '2025-09-27', 98657, 99887, 1230],
  ['AAPL', '2024-09-28', 106629, 107525, 896],
  ['AAPL', '2023-09-30', 111088, 112112, 1024],
  ['MSFT', '2026-06-30', 40294, 106888, 66594],
  ['MSFT', '2025-06-30', 43151, 89323, 46172],
  ['MSFT', '2024-06-30', 51630, 78775, 27145],
  ['MSFT', '2023-06-30', 47237, 64304, 17067],
  ['GOOGL', '2025-12-31', 48543, 51043, 2500],
  ['GOOGL', '2024-12-31', 14182, 15859, 1677],
])(
  'SEC %s %s restores reported debt and finance leases without fake zero components',
  (ticker, end, plain, funding, leases) => {
    const row = rows(ticker as string).find((r) => r.periodEnd === end)!;
    expect(row.totalDebt).toBe((plain as number) * 1e6);
    expect(inputs(row).financingDebt.value).toBe((funding as number) * 1e6);
    expect(inputs(row).financeLeases.value).toBe((leases as number) * 1e6);
    expect(inputs(row).financeLeasesIncludedInDebt).toBe(true);
    if (ticker === 'AAPL' || ticker === 'MSFT')
      expect(
        inputs(row).debtComponents.OtherShortTermBorrowings.value,
      ).toBeNull();
    expect(row.netDebt).toBe(row.totalDebt! - row.cash!);
    expect(row.debtToEquity).toBeCloseTo(row.totalDebt! / row.equity!);
    expect(
      JSON.parse(JSON.stringify(row.sources)).debtDocumentProof.version,
    ).toBe('debt-disclosure-v1');
    expect(row.sources).not.toHaveProperty('roic');
  },
);
it('uses the precise MSFT commercial-paper balance with declared coarse prose precision, never 6.7 billion as exact debt', () => {
  const m = extracted.find(
    (x) =>
      x.metadata.ticker === 'MSFT' && x.metadata.reportDate === '2024-06-30',
  )!;
  expect(
    m.disclosures.find((x) => x.periodEnd === '2024-06-30')?.plainDebt,
  ).toBe(51630e6);
});
it('preserves the historical combined lease/other scope and flags incompatible comparative financing totals', () => {
  const rs = rows('GOOGL');
  const start = rs.find((r) => r.periodEnd === '2022-12-31')!;
  expect(inputs(start).financingDebt.value).toBe(14999e6);
  expect(inputs(start).financeLeases.value).toBeNull();
  expect(start.totalDebt).toBeNull();
  const revised = rs.find((r) => r.periodEnd === '2023-12-31')!;
  expect(revised.totalDebt).toBe(12870e6);
  expect(inputs(revised).financingDebt.value).toBeNull();
  expect(inputs(revised).financingDebt.reason).toContain('历史申报');
});
it('does not merge a debt document into a restated, incompatible balance sheet', () => {
  const raw = structuredClone(facts.MSFT.raw);
  for (const f of raw.facts['us-gaap'].Assets.units.USD)
    if (f.end === '2026-06-30') f.val += 1;
  const row = normalizeCompanyFacts(raw, forCompany('MSFT')).annual.find(
    (r) => r.periodEnd === '2026-06-30',
  )!;
  expect(row.sources.debtDocumentProof).toBeUndefined();
  expect(row.totalDebt).toBeNull();
});
it('KO current investments are classified by actual primary statement position; disposal debt and leases stay pending', () => {
  const rs = rows('KO');
  for (const [end, expected] of [
    ['2025-12-31', 5536],
    ['2024-12-31', 3743],
    ['2023-12-31', 4297],
  ] as const) {
    const row = rs.find((r) => r.periodEnd === end)!;
    expect(inputs(row).currentFinancialInvestments.value).toBe(expected * 1e6);
    expect(inputs(row).financingDebt.value).toBeNull();
    expect(inputs(row).financingDebt.reason).toContain('待售');
    expect(inputs(row).financeLeases.value).toBeNull();
  }
});
it('rejects filing identity mismatches and altered statement balances without trusting stored reference amounts', () => {
  const d = extracted.find((x) => x.metadata.ticker === 'AAPL')!;
  expect(() =>
    extractDebtDisclosures(d.html, { ...d.metadata, cik: '0000000001' }),
  ).toThrow();
  expect(() =>
    extractDebtDisclosures(d.html, { ...d.metadata, reportDate: '2020-01-01' }),
  ).toThrow();
  const altered = d.html.replace('>404,548<', '>404,549<');
  expect(
    extractDebtDisclosures(altered, d.metadata).some(
      (x) => x.periodEnd === '2026-09-26',
    ),
  ).toBe(false);
});
it('bounded SEC acquisition uses only official filing paths and keeps failures retryable without database/AI calls', async () => {
  const m = extracted.find((x) => x.metadata.ticker === 'AAPL')!;
  const recent = {
    form: ['10-K', '10-K', '10-K', '10-K', '10-Q', '10-Q'],
    accessionNumber: Array(6).fill(m.metadata.accessionNumber),
    reportDate: Array(6).fill(m.metadata.reportDate),
    filingDate: Array(6).fill(m.metadata.filingDate),
    primaryDocument: Array(6).fill('aapl-20260926.htm'),
  };
  const client = {
    getJson: jest
      .fn()
      .mockResolvedValue({ cik: m.metadata.cik, filings: { recent } }),
    getText: jest.fn().mockResolvedValue(m.html),
  };
  const service = new SecService(client as never);
  expect(
    (await service.getDebtDisclosures(m.metadata.cik)).disclosures.length,
  ).toBeGreaterThan(0);
  expect(client.getText).toHaveBeenCalledTimes(4);
  client.getText.mockRejectedValue(new Error('temporary failure'));
  expect(
    (await service.getDebtDisclosures(m.metadata.cik)).diagnostics,
  ).toHaveLength(4);
  client.getText.mockResolvedValue(m.html);
  expect(
    (await service.getDebtDisclosures(m.metadata.cik)).disclosures.length,
  ).toBeGreaterThan(0);
});

it('DCF annual bridge receives restored plain debt while FCFF and operating baselines stay unchanged', async () => {
  const { valuationBaseline } =
    await import('../src/modules/valuation/baseline');
  const f = facts.MSFT;
  const m = manifest.find(
    (x) => x.ticker === 'MSFT' && x.reportDate === '2026-06-30',
  )!;
  const sub = {
    cik: m.cik,
    sic: '7372',
    name: 'SEC fixture',
    filings: {
      recent: {
        form: ['10-K'],
        reportDate: [m.reportDate],
        filingDate: [m.filingDate],
        accessionNumber: [m.accessionNumber],
      },
    },
  };
  const before = valuationBaseline(f.raw, sub, 'MSFT', m.cik);
  const after = valuationBaseline(
    f.raw,
    sub,
    'MSFT',
    m.cik,
    forCompany('MSFT'),
  );
  expect(after.bridgeDisclosures?.items.totalDebt.value).toBe(40294e6);
  expect(
    after.quality?.capital.find((x) => x.periodEnd === m.reportDate)
      ?.verifiedInputs?.financingDebt.value,
  ).toBe(106888e6);
  expect(after.fcf).toBe(before.fcf);
  expect(after.fcff).toBe(before.fcff);
  expect(after.revenue).toEqual(before.revenue);
  expect(after.ebit).toEqual(before.ebit);
  expect(after).not.toHaveProperty('roic');
});

it('does not accept a coarse prose amount outside its declared rounding interval', () => {
  const d = extracted.find(
    (x) =>
      x.metadata.ticker === 'MSFT' && x.metadata.reportDate === '2024-06-30',
  )!;
  const $ = load(d.html, { xmlMode: true });
  $('*')
    .filter(
      (_, n) =>
        n.type === 'tag' &&
        n.attribs.name === 'us-gaap:CommercialPaper' &&
        $(n).text() === '6.7',
    )
    .text('6.8');
  expect(
    extractDebtDisclosures($.xml(), d.metadata).some(
      (x) => x.periodEnd === '2024-06-30',
    ),
  ).toBe(false);
});
it('rejects unsupported currency and a missing debt-note rollup rather than inferring unreported debt', () => {
  const d = extracted.find((x) => x.metadata.ticker === 'AAPL')!;
  expect(
    extractDebtDisclosures(
      d.html.replaceAll('iso4217:USD', 'iso4217:EUR'),
      d.metadata,
    ),
  ).toEqual([]);
  const $ = load(d.html, { xmlMode: true });
  $('table')
    .filter((_, t) => {
      const names = $(t)
        .find('*')
        .toArray()
        .filter((n) => n.type === 'tag')
        .map((n) => n.attribs.name);
      return (
        names.includes('us-gaap:LongTermDebtCurrent') &&
        names.includes('us-gaap:LongTermDebtNoncurrent') &&
        !names.includes('us-gaap:Assets')
      );
    })
    .remove();
  expect(extractDebtDisclosures($.xml(), d.metadata)).toEqual([]);
});
