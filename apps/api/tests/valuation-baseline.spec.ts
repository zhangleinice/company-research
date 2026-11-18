import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { valuationBaseline } from '../src/modules/valuation/baseline';
const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/valuation-baselines.json'), 'utf8'),
) as Record<
  string,
  {
    raw: Parameters<typeof valuationBaseline>[0];
    sub: Parameters<typeof valuationBaseline>[1];
  }
>;
it.each([
  ['GOOGL', 471098, 179551, 159804, 19747],
  ['MSFT', 346445, 195878, 135921, 59957],
  ['KO', 51054, 16227, 1945, 14282],
])(
  'builds actual %s TTM from matching fiscal dates, preserves unapproved FCFF',
  (t, revenue, ocf, capex, fcf) => {
    const f = fixtures[t as string];
    const b = valuationBaseline(f.raw, f.sub, t as string, String(f.raw.cik));
    expect(b.revenue.value).toBe((revenue as number) * 1e6);
    expect(b.ocf.value).toBe((ocf as number) * 1e6);
    expect(b.capex.value).toBe((capex as number) * 1e6);
    expect(b.fcf).toBe((fcf as number) * 1e6);
    expect(b.fcff).toBeNull();
    expect(b.ocf.start).toBe(b.capex.start);
    expect(b.ocf.end).toBe(b.capex.end);
    expect(b.ocf.items).toHaveLength(3);
  },
);
it('does not infer missing capex as zero or substitute prior period; verifies identity and financial-sector exclusion', () => {
  const f = structuredClone(fixtures.GOOGL);
  delete f.raw.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment;
  const b = valuationBaseline(f.raw, f.sub, 'GOOGL', String(f.raw.cik));
  expect(b.fcf).toBeNull();
  expect(b.capex.value).toBeNull();
  f.sub.sic = '6020';
  expect(
    valuationBaseline(f.raw, f.sub, 'GOOGL', String(f.raw.cik)).applicable,
  ).toBe(false);
  expect(() =>
    valuationBaseline(f.raw, f.sub, 'GOOGL', '0000000001'),
  ).toThrow();
});
