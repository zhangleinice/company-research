import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
interface Fact {
  start: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
  form: string;
  fy?: number;
  fp?: string;
}
interface Raw {
  facts: { 'us-gaap': Record<string, { units: Record<string, Fact[]> }> };
}
const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/quarterly-eps-audit.json'), 'utf8'),
) as Record<string, Raw>;
const result = (cik: string) => normalizeCompanyFacts(fixtures[cik]);

it('retains the real split-adjusted independent EPS but suppresses the mixed-basis NVDA FY2025 Q1 YoY', () => {
  const row = result('0001045810').quarterly.find(
    (r) => r.periodEnd === '2024-04-28',
  )!;
  expect(row.eps).toBe(0.6);
  expect(row.epsGrowth).toBeNull();
  expect(row.sources.epsGrowth).toMatchObject({
    method: 'unavailable',
    comparisonPeriodEnd: '2023-04-30',
  });
  expect(row.revenue).toBe(26044000000);
  expect(row.revenueGrowth).toBeCloseTo(262.12458287);
});
it.each([
  ['0001652044', '2026-09-30', 2.12, -26.13240418],
  ['0000320193', '2026-06-27', 2.02, 28.66242038],
  ['0001045810', '2024-07-28', 0.67, 168],
])(
  'preserves verified EPS and YoY for %s %s with auditable common-filing inputs',
  (cik, end, eps, growth) => {
    const row = result(cik as string).quarterly.find(
      (r) => r.periodEnd === end,
    )!;
    expect(row.eps).toBe(eps);
    expect(row.epsGrowth).toBeCloseTo(growth as number);
    const source = row.sources.epsGrowth as {
      items: Array<Fact & { concept: string; unit: string }>;
    };
    const [now, before] = source.items;
    expect(now.accn).toBe(before.accn);
    expect(now.filed).toBe(before.filed);
    expect(now.unit).toBe('USD/shares');
    expect(now.val).toBe(row.eps);
    expect(now.start).toBe(row.periodStart);
    expect(now.end).toBe(row.periodEnd);
  },
);
it('does not treat identical concept/unit in different filings as sufficient; preserves all non-YoY values', () => {
  const raw = structuredClone(fixtures['0001652044']);
  const baseline = normalizeCompanyFacts(raw);
  const eps = raw.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'];
  raw.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'] = eps.filter(
    (f) =>
      !(
        f.start === '2025-07-01' &&
        f.end === '2025-09-30' &&
        f.accn === '0001652044-26-000084'
      ),
  );
  const after = normalizeCompanyFacts(raw);
  const row = after.quarterly.find((r) => r.periodEnd === '2026-09-30')!;
  expect(row.eps).toBe(2.12);
  expect(row.epsGrowth).toBeNull();
  for (const period of after.quarterly) {
    const old = baseline.quarterly.find(
      (r) => r.periodEnd === period.periodEnd,
    )!;
    const strip = ({
      sources: _sources,
      epsGrowth: _growth,
      ...rest
    }: typeof period) => {
      void _sources;
      void _growth;
      return rest;
    };
    expect(strip(period)).toEqual(strip(old));
  }
  expect(after.annual).toEqual(baseline.annual);
});
it('will not substitute an older current EPS merely to obtain an attractive comparison', () => {
  const raw = structuredClone(fixtures['0001045810']);
  const row = normalizeCompanyFacts(raw).quarterly.find(
    (r) => r.periodEnd === '2024-04-28',
  )!;
  const older = raw.facts['us-gaap'].EarningsPerShareDiluted.units[
    'USD/shares'
  ].filter((f) => f.accn === '0001045810-24-000124');
  expect(older.find((f) => f.end === '2024-04-28')?.val).toBe(5.98);
  expect(older.find((f) => f.end === '2023-04-30')?.val).toBe(0.82);
  expect(row.eps).toBe(0.6);
  expect(row.epsGrowth).toBeNull();
});
it('leaves Q4 EPS and EPS YoY missing instead of subtracting annual/YTD EPS', () => {
  for (const cik of Object.keys(fixtures)) {
    const q4 = result(cik).quarterly.filter((r) => r.fiscalQuarter === 4);
    expect(q4.length).toBeGreaterThan(0);
    for (const row of q4) {
      expect(row.eps).toBeNull();
      expect(row.epsGrowth).toBeNull();
    }
  }
});
