import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { valuationBaseline } from '../src/modules/valuation/baseline';
import { withResearchFcff } from '../src/modules/valuation/research-fcff';
const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/valuation-baselines.json'), 'utf8'),
);
const base = () =>
  valuationBaseline(
    fixtures.GOOGL.raw,
    fixtures.GOOGL.sub,
    'GOOGL',
    '0001652044',
  );
it('automatically builds a conditional TTM base from actual SEC expense, never upgrades it to approved FCFF', () => {
  const b = base();
  expect(b.fcf).toBe(19747e6);
  expect(b.interest.value).toBe(3076e6);
  expect(b.fcff).toBeNull();
  expect(b.fcffEstimate?.status).toBe('RESEARCH');
  expect(b.fcffEstimate?.value).toBeCloseTo(22177.04e6);
  expect(b.fcffEstimate?.taxRate).toBe(0.21);
  expect(b.fcffEstimate?.assumptions.join()).toContain('资本化');
});
it('keeps disclosed capitalized interest separate rather than adding it again or substituting zero', () => {
  const b = base();
  b.fcffChecks!.capitalizedInterest = { ...b.ocf, value: 1146e6 };
  const r = withResearchFcff(b);
  expect(r.fcffEstimate?.value).toBeCloseTo(22177.04e6);
  expect(r.fcffEstimate?.assumptions.join()).toContain('1146');
  b.fcffChecks!.capitalizedInterest.value = null;
  expect(withResearchFcff(b).fcffEstimate?.assumptions.join()).toContain(
    '金额尚不完整',
  );
});
it('preserves approved FCFF and excludes financial or loss-making companies', () => {
  const b = base();
  b.fcff = 123;
  expect(withResearchFcff(b).fcff).toBe(123);
  b.fcff = null;
  b.applicable = false;
  expect(withResearchFcff(b).fcffEstimate?.value).toBeNull();
  b.applicable = true;
  b.ebit.value = -1;
  expect(withResearchFcff(b).fcffEstimate?.value).toBeNull();
});
it('rejects missing interest, mismatched periods, partial debt-only expense and unknown source units', () => {
  for (const mutation of [
    (b: ReturnType<typeof base>) => {
      b.interest.value = null;
    },
    (b: ReturnType<typeof base>) => {
      b.interest.start = '2020-01-01';
    },
    (b: ReturnType<typeof base>) => {
      b.interest.concept = 'us-gaap:InterestExpenseDebt';
    },
    (b: ReturnType<typeof base>) => {
      b.interest.items[0].unit = 'shares';
    },
    (b: ReturnType<typeof base>) => {
      b.capex.value = null;
    },
  ]) {
    const b = base();
    mutation(b);
    expect(withResearchFcff(b).fcffEstimate?.value).toBeNull();
  }
});
it('does not silently ignore disclosed cash/expense differences or nonpositive research FCFF', () => {
  const b = base();
  b.fcffChecks!.cashInterest = { ...b.interest, value: 999e6 };
  expect(withResearchFcff(b).fcffEstimate?.value).toBeNull();
  const loss = base();
  loss.ocf.value = 1;
  loss.capex.value = 1e12;
  loss.fcf = 1 - 1e12;
  expect(withResearchFcff(loss).fcffEstimate?.value).toBeNull();
});
it('an explicit reported zero interest can be used, while missing interest cannot', () => {
  const b = base();
  b.interest.value = 0;
  expect(withResearchFcff(b).fcffEstimate?.value).toBe(b.fcf);
  b.interest.value = null;
  expect(withResearchFcff(b).fcffEstimate?.value).toBeNull();
});
