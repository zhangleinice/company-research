import {
  epsGrowth,
  historicalRoe,
  justifiedPe,
  multipleIndustry,
  peValue,
  pegPe,
  type MultipleYear,
} from '@company-research/shared';
import { multipleInputs } from '../src/modules/valuation/multiple-inputs';
const row = (
  year = 2025,
  eps: number | null = 5,
  start = `${year}-01-01`,
  end = `${year}-12-31`,
) => ({
  periodStart: new Date(start),
  periodEnd: new Date(end),
  fiscalYear: year,
  currency: 'USD',
  eps,
  roe: 20,
  epsCagr3y: 10,
  epsCagr5y: 10,
  sources: {
    eps: {
      method: 'reported',
      items: [
        {
          start,
          end,
          val: eps,
          concept: 'us-gaap:EarningsPerShareDiluted',
          unit: 'USD/shares',
          accn: '0000000001-26-000001',
          filed: '2026-02-01',
          form: '10-K',
        },
      ],
    },
    roe: { inputs: [{ concept: 'us-gaap:NetIncomeLoss', val: 100 }] },
  },
});
const years = () =>
  Array.from(
    { length: 6 },
    (_, i) =>
      ({
        year: 2025 - i,
        start: `${2025 - i}-01-01`,
        end: `${2025 - i}-12-31`,
        eps: {
          value: 2 * 1.1 ** (5 - i),
          start: `${2025 - i}-01-01`,
          end: `${2025 - i}-12-31`,
          reason: null,
          sources: [],
        },
        roe: 0.2,
        roeSources: [],
        comparableCagr: { 3: 0.1, 5: 0.1 },
      }) satisfies MultipleYear,
  );
it('implements PE, justified PE and PEG without using WACC or clamping inputs', () => {
  expect(peValue(5, 20).value).toBe(100);
  expect(justifiedPe(0.2, 0.02, 0.1).value).toBeCloseTo(11.475);
  expect(pegPe(0.15, 1).value).toBe(15);
  expect(peValue(5, pegPe(0.15, 1).value).value).toBe(75);
  expect(justifiedPe(0.2, 0, 0.1).value).toBe(10);
  for (const [roe, g, ke] of [
    [0, 0.02, 0.1],
    [0.2, 0.1, 0.1],
    [0.2, 0.2, 0.3],
    [0.2, -0.01, 0.1],
    [null, 0.02, 0.1],
  ])
    expect(justifiedPe(roe, g, ke).value).toBeNull();
  expect(peValue(-1, 10).value).toBeNull();
  expect(peValue(null, 10).value).toBeNull();
  expect(peValue(1, 0).value).toBeNull();
  expect(pegPe(-0.1, 1).value).toBeNull();
  expect(pegPe(0.1, 0).value).toBeNull();
  expect(peValue(1e308, 100).value).toBeNull();
  expect(pegPe(2, 1).value).toBe(200);
});
it('requires continuous positive comparable annual EPS, preserving split validation and volatility warnings', () => {
  const ys = years();
  expect(epsGrowth(ys, 5).value).toBeCloseTo(0.1);
  expect(epsGrowth(ys, 3).value).toBeCloseTo(0.1);
  expect(epsGrowth(ys.slice(0, 5), 5).value).toBeNull();
  ys[2].eps.value = -1;
  expect(epsGrowth(ys, 5).value).toBeNull();
  ys[2].eps.value = 0.01;
  expect(epsGrowth(ys, 5).warnings.join('')).toContain('波动');
  ys[0].comparableCagr[5] = 0.2;
  expect(epsGrowth(ys, 5).value).toBeNull();
  const gapped = years();
  gapped[3].year = 2018;
  expect(epsGrowth(gapped, 5).value).toBeNull();
});
it('uses median of last five reported ROEs, reports sparse and low-equity distortions', () => {
  const ys = years();
  ys[0].roe = 1.6;
  expect(historicalRoe(ys).value).toBe(0.2);
  expect(historicalRoe(ys).warnings.join('')).toContain('低权益');
  expect(historicalRoe(ys.slice(0, 2)).warnings.join('')).toContain('不足');
  expect(historicalRoe([]).value).toBeNull();
  const gap = years().filter((x) => x.year !== 2023);
  gap[gap.length - 1].roe = 100;
  expect(historicalRoe(gap).warnings.join('')).toContain('4个有效ROE');
  expect(historicalRoe(gap).value).toBe(0.2);
  expect(multipleIndustry('3571').name).toBe('Computers/Peripherals');
  expect(multipleIndustry('7370').name).toBe('Computer Services');
  expect(multipleIndustry('2080').name).toBeNull();
  expect(multipleIndustry('2080', 'Beverage (Soft)').name).toBe(
    'Beverage (Soft)',
  );
});
it('reads annual EPS with exact periods and sources; same-date Q4 cannot shadow annual EPS', () => {
  const annual = row(),
    q = { ...row(2025, null, '2025-10-01'), sources: {} };
  const d = multipleInputs('0000000001', '3571', [annual], [q], '2025-12-31');
  expect(d.ttm.value).toBe(5);
  expect(d.annual[0].eps.sources).toHaveLength(1);
  expect(d.annual[0].roe).toBe(0.2);
  annual.sources.eps.items[0].unit = 'USD';
  expect(
    multipleInputs('0000000001', null, [annual], [q], '2025-12-31').ttm.value,
  ).toBeNull();
});
it('never derives Q4 from cumulative EPS or uses stale annual EPS as latest TTM', () => {
  const qs = [
    row(2025, 3, '2025-07-01', '2025-09-30'),
    row(2025, 2, '2025-04-01', '2025-06-30'),
    row(2025, 1, '2025-01-01', '2025-03-31'),
    row(2024, null, '2024-10-01', '2024-12-31'),
  ];
  const d = multipleInputs(
    '0000000001',
    null,
    [row(2024, 10)],
    qs,
    '2025-09-30',
  );
  expect(d.ttm.value).toBeNull();
  expect(d.ttm.end).toBe('2025-09-30');
  expect(d.annual[0].eps.value).toBe(10);
  qs[3] = row(2024, 4, '2024-10-01', '2024-12-31');
  expect(
    multipleInputs('0000000001', null, [row(2024)], qs, '2025-09-30').ttm.value,
  ).toBe(10);
  qs[0] = row(2025, 6, '2025-01-01', '2025-09-30');
  expect(
    multipleInputs('0000000001', null, [row(2024)], qs, '2025-09-30').ttm.value,
  ).toBeNull();
  qs[0] = row(2025, 3, '2025-07-01', '2025-09-30');
  qs[0].sources.eps.items[0].accn = '0000000001-25-000002';
  expect(
    multipleInputs('0000000001', null, [row(2024)], qs, '2025-09-30').ttm.value,
  ).toBeNull();
});
