import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  calculateDcf,
  emptyEquityBridge,
  type ValuationBaseline,
  type ValuationReferences,
} from '@company-research/shared';
import { DcfCalculator } from '../src/ValuationPage.js';
import {
  calculatorInput,
  initialScenario,
  referenceBridge,
  validateScenarioField,
  fcffBasis,
} from '../src/valuation-calculator.js';
const missing = {
  value: null,
  start: null,
  end: '2026-09-30',
  concept: null,
  items: [],
};
const baseline: ValuationBaseline = {
  ticker: 'TEST',
  cik: '0000000001',
  name: 'Test',
  asOf: '2026-09-30',
  checkedAt: '2026-11-18',
  applicable: true,
  status: 'REVIEW_REQUIRED',
  warnings: [],
  revenue: missing,
  ebit: missing,
  ocf: missing,
  capex: missing,
  interest: missing,
  fcf: 100e6,
  fcff: null,
};
const params = () => ({
  ...initialScenario,
  useResearch: false,
  researchValue: null as number | null,
  researchReason: '',
  bridge: emptyEquityBridge(),
});
test('DCF retains its forecast table and defaults while showing the compact read-only equity bridge', () => {
  const html = renderToStaticMarkup(
    createElement(DcfCalculator, { ticker: 'GOOGL' }),
  );
  for (const text of [
    '自由现金流',
    '估值假设',
    '现金流折现',
    '每股内在价值',
    'FCF = OCF',
    'FCFF(t) = FCFF₀',
  ])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/class="ant-card(?:\s|")/g) ?? []).length, 0);
  assert.equal((html.match(/<table/g) ?? []).length, 2);
  assert.ok(!html.includes('数据来源'));
  assert.ok(html.includes('data-dcf-metric="fcff"'));
  assert.ok(html.includes('data-dcf-metric="ev"'));
  assert.ok(html.includes('EV价值构成'));
  assert.ok(html.includes('预计FCFF / TV'));
  assert.ok(html.includes('第6年～永续（TV）'));
  assert.ok(html.includes('合计EV'));
  assert.match(
    html,
    /<details class="dcf-details dcf-calculation-details"><summary>查看计算公式<\/summary>/,
  );
  assert.equal(
    (
      html
        .match(/<tbody[^>]*>[\s\S]*?<\/tbody>/)?.[0]
        .match(/<tr[^>]*data-row-key=/g) ?? []
    ).length,
    7,
  );
  assert.ok(html.includes('暂不能计算每股内在价值'));
  assert.ok(html.includes('SEC财报金额'));
  assert.ok(html.includes('估值调整 / 结果'));
  assert.ok(!html.includes('class="dcf-result"'));
  assert.ok(html.includes('FCFF基准'));
  assert.ok(html.includes('税率'));
  assert.ok(html.includes('增长率估值方法'));
  assert.ok(html.includes('WACC行业选择'));
  assert.ok(!html.includes('恢复参考值'));
  assert.ok(!html.includes('checkbox'));
  assert.ok(!html.includes('估值调整依据'));
  assert.ok(!html.includes('<pre'));
  assert.ok(!html.includes('value="0"'));
  assert.ok(!html.includes('value="5"'));
  assert.ok(!html.includes('value="10"'));
  assert.ok(!html.includes('value="3"'));
});
test('reliable FCFF automatically produces all five rows and EV without interactive confirmation', () => {
  const r = calculateDcf(
    calculatorInput({ ...baseline, fcff: 100e6 }, params()),
  );
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[0].fcff, 105);
  assert.ok(r.ev! > 0);
  assert.equal(r.perShare, null);
});
test('FCF does not silently become FCFF; explicit research basis is separate and requires positive value, rationale, with no checkbox gate', () => {
  const p = params();
  assert.equal(calculateDcf(calculatorInput(baseline, p)).ev, null);
  p.useResearch = true;
  p.researchValue = 100;
  assert.equal(calculateDcf(calculatorInput(baseline, p)).ev, null);
  p.researchReason =
    'Cash interest and shield adjustment estimated from filings for conditional scenario';
  const i = calculatorInput(baseline, p),
    r = calculateDcf(i);
  assert.equal(i.historicalVerified, false);
  assert.equal(i.historicalFcff, null);
  assert.ok(r.ev! > 0);
  assert.equal(r.rows[0].fcff, 105);
  assert.equal(r.equity, null);
  assert.equal(r.perShare, null);
  p.researchValue = -1;
  assert.equal(calculateDcf(calculatorInput(baseline, p)).ev, null);
});
test('modifying growth, discount rate and perpetual growth recalculates independently; invalid WACC remains blocked', () => {
  const p = {
    ...params(),
    useResearch: true,
    researchValue: 100,
    researchReason: 'Explicit test research basis',
  };
  const a = calculateDcf(calculatorInput(baseline, p));
  p.growth = 6;
  const b = calculateDcf(calculatorInput(baseline, p));
  assert.notEqual(a.rows[0].fcff, b.rows[0].fcff);
  p.terminalGrowth = 2;
  const c = calculateDcf(calculatorInput(baseline, p));
  assert.equal(b.rows[0].fcff, c.rows[0].fcff);
  assert.notEqual(b.terminalValue, c.terminalValue);
  p.wacc = 12;
  assert.notEqual(c.ev, calculateDcf(calculatorInput(baseline, p)).ev);
  p.wacc = 2;
  assert.equal(calculateDcf(calculatorInput(baseline, p)).ev, null);
});
test('SEC cache references convert units once without adding all cash or inventing claims; latest source remains inspectable', () => {
  const refs: ValuationReferences = {
    periodEnd: '2026-09-30',
    cash: 100e6,
    debt: 20e6,
    shares: 10e6,
    sharesBasis: 'weightedDiluted',
    sources: { totalDebt: { concept: 'Debt' } },
  };
  const b = referenceBridge(refs, 'TEST');
  assert.equal(b.items.debt.value, 20);
  assert.equal(b.items.shares.value, 10);
  assert.equal(b.items.excessCash.value, null);
  assert.equal(b.items.otherClaims.value, null);
  assert.equal(b.claimsReviewed, false);
  const p = {
    ...params(),
    bridge: b,
    useResearch: true,
    researchValue: 100,
    researchReason: 'Explicit test estimate',
  };
  const r = calculateDcf(calculatorInput(baseline, p));
  assert.ok(r.ev! > 0);
  assert.equal(r.perShare, null);
  b.unresolved = 'Material unquantified tax claim';
  assert.equal(calculateDcf(calculatorInput(baseline, p)).perShare, null);
});

test('automatic research FCFF starts forecasts without manual entry, with priority for approved data', () => {
  const b = {
    ...baseline,
    fcffEstimate: {
      status: 'RESEARCH' as const,
      value: 22177.04e6,
      taxRate: 0.21,
      reason: 'Explicit research assumptions',
      assumptions: [
        'Expenses proxy cash paid; no capitalized interest addback',
      ],
      version: 'test',
    },
  };
  const i = calculatorInput(b, params()),
    r = calculateDcf(i);
  assert.equal(i.historicalVerified, false);
  assert.ok(r.ev! > 0);
  assert.equal(r.rows[0].fcff, 22177.04 * 1.05);
  assert.equal(fcffBasis({ ...b, fcff: 100e6 }, params()).value, 100);
});
test('blur/Enter validation rejects incomplete or invalid drafts without replacing committed parameters', () => {
  const current = { ...initialScenario };
  for (const [key, value] of [
    ['wacc', 3],
    ['wacc', null],
    ['wacc', 101],
    ['growth', -100],
    ['terminalGrowth', 10],
  ] as const) {
    const r = validateScenarioField(current, key, value);
    assert.ok(r.error);
    assert.equal(r.next, current);
  }
  const r = validateScenarioField(current, 'growth', 6);
  assert.equal(r.error, '');
  assert.equal(r.next.growth, 6);
  assert.equal(current.growth, 5);
  assert.deepEqual(initialScenario, { growth: 5, wacc: 10, terminalGrowth: 3 });
});
