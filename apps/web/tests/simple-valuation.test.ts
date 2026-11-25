import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  calculateDcf,
  SIC_WACC_MAP,
  emptyEquityBridge,
  type SimpleValuationData,
  type SimpleFcffPeriod,
  type ValuationBaseline,
} from '@company-research/shared';
import {
  emptySimpleSettings,
  resolveSimpleSettings,
  setSimpleOverride,
  resetSimpleOverride,
  simpleCalculationBaseline,
} from '../src/simple-valuation-state.js';
import { calculatorInput } from '../src/valuation-calculator.js';
import { SimpleValuationControls } from '../src/SimpleValuationControls.js';
import industries from '../src/data/industry-wacc-us.json' with { type: 'json' };
const f = (n: number) => ({
  value: n * 1e6,
  start: '2025-01-01',
  end: '2025-12-31',
  concept: 'us-gaap:Test',
  items: [{ unit: 'USD' }],
});
function data(): SimpleValuationData {
  const period: SimpleFcffPeriod = {
    label: 'TTM',
    start: '2025-01-01',
    end: '2025-12-31',
    ocf: f(200),
    capex: f(50),
    interest: f(10),
    revenue: f(1000),
    tax: f(25),
    pretax: f(100),
    taxSourceValid: true,
    approximationAllowed: true,
    reason: null,
    warnings: ['现金付息代理限制'],
  };
  return {
    version: 1,
    currency: 'USD',
    cik: '0000000001',
    sic: '3571',
    usIncorporated: true,
    incorporation: 'CA',
    profileSource: 'SEC',
    ttm: period,
    latestAnnual: {
      ...period,
      label: 'FY2025',
      ocf: f(300),
      capex: f(100),
      interest: f(20),
    },
    annual: Array.from({ length: 6 }, (_, i) => ({
      year: 2020 + i,
      start: `${2020 + i}-01-01`,
      end: `${2020 + i}-12-31`,
      revenue: 100e6 * 1.1 ** i,
      fcf: 10e6 * 1.2 ** i,
      capex: 5e6,
      sources: {},
    })),
  };
}
test('default settings, tax and annual/manual FCFF selections use raw source-specific values', () => {
  const d = data();
  let s = emptySimpleSettings();
  const r = resolveSimpleSettings(d, s, industries);
  assert.equal(r.tax.value, 0.21);
  assert.equal(r.fcff.value, 157.9);
  assert.ok(Math.abs(r.parameters.growth! - 20) < 1e-10);
  assert.equal(r.parameters.terminalGrowth, 2);
  assert.equal(
    r.parameters.wacc,
    industries.industries.find((x) => x.name === 'Computers/Peripherals')!
      .wacc * 100,
  );
  s = { ...s, basis: 'annual' };
  assert.equal(resolveSimpleSettings(d, s, industries).fcff.value, 215.8);
  s = { ...s, taxMethod: 'effective' };
  assert.equal(resolveSimpleSettings(d, s, industries).fcff.value, 215);
  s = { ...s, taxMethod: 'manual', taxManual: 0 };
  assert.equal(resolveSimpleSettings(d, s, industries).fcff.value, 220);
  s = {
    ...s,
    basis: 'manual',
    manualFcff: 80,
    manualReason: 'Explicit research normalization',
  };
  assert.equal(resolveSimpleSettings(d, s, industries).fcff.value, 80);
  assert.equal(
    resolveSimpleSettings(d, { ...s, manualReason: '' }, industries).fcff.value,
    null,
  );
});
test('overrides distinguish zero, clearing and default restoration; absent references never become 5% or 10%', () => {
  const d = data(),
    initial = emptySimpleSettings();
  let s = setSimpleOverride(initial, 'growth', 0);
  assert.equal(resolveSimpleSettings(d, s, industries).parameters.growth, 0);
  s = setSimpleOverride(s, 'growth', null);
  assert.equal(resolveSimpleSettings(d, s, industries).parameters.growth, null);
  s = resetSimpleOverride(s, 'growth');
  assert.ok(resolveSimpleSettings(d, s, industries).parameters.growth! > 19);
  d.sic = null;
  d.annual[0].fcf = null;
  const missing = resolveSimpleSettings(d, initial, industries);
  assert.equal(missing.parameters.wacc, null);
  assert.equal(missing.parameters.growth, null);
  assert.ok(
    resolveSimpleSettings(
      d,
      { ...initial, growthMethod: 'revenue', industry: 'Beverage (Soft)' },
      industries,
    ).parameters.wacc! > 0,
  );
  assert.equal(
    resolveSimpleSettings(null, initial, industries).parameters.growth,
    null,
  );
});
test('parameter changes use the existing five-year DCF; WACC/terminal inequality remains mandatory', () => {
  const d = data(),
    s = emptySimpleSettings();
  const b: ValuationBaseline = {
    ticker: 'TEST',
    cik: d.cik,
    name: null,
    asOf: d.ttm.end,
    checkedAt: '2026-01-01',
    applicable: true,
    status: 'REVIEW_REQUIRED',
    warnings: [],
    revenue: f(1000),
    ocf: f(200),
    capex: f(50),
    interest: f(10),
    ebit: f(100),
    fcf: 150e6,
    fcff: null,
  };
  const run = (state: typeof s) => {
    const r = resolveSimpleSettings(d, state, industries);
    return calculateDcf(
      calculatorInput(simpleCalculationBaseline(b, state, r), {
        ...r.parameters,
        useResearch: false,
        researchValue: null,
        researchReason: '',
        bridge: emptyEquityBridge(),
      }),
    );
  };
  const first = run(s);
  assert.equal(first.rows.length, 5);
  assert.ok(first.ev! > 0);
  assert.equal(first.perShare, null);
  assert.notEqual(run(setSimpleOverride(s, 'wacc', 12)).ev, first.ev);
  assert.equal(run(setSimpleOverride(s, 'wacc', 1)).ev, null);
  assert.notEqual(run({ ...s, basis: 'annual' }).ev, first.ev);
});
test('compact controls expose selectors and restores without new cards, market data or confirmation workflow', () => {
  const d = data(),
    s = emptySimpleSettings();
  const html = renderToStaticMarkup(
    createElement(SimpleValuationControls, {
      data: d,
      settings: s,
      resolved: resolveSimpleSettings(d, s, industries),
      industries,
      onChange: () => {},
    }),
  );
  for (const label of [
    'FCFF基准选择',
    '税率方法',
    '增长率估值方法',
    'WACC行业选择',
    '未来5年FCFF增长率',
    '永续增长率',
    '恢复默认',
  ])
    assert.ok(html.includes(label), label);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.ok(
    html.indexOf('aria-label="未来5年FCFF增长率"') <
      html.indexOf('aria-label="增长率估值方法"'),
  );
  assert.ok(
    html.indexOf('aria-label="WACC折现率"') <
      html.indexOf('aria-label="WACC行业选择"'),
  );
  assert.ok(!html.includes('参数变化实时重算'));
  assert.ok(!html.includes('ant-checkbox'));
  assert.ok(!html.includes('ant-card'));
  assert.ok(!html.includes('CAPM'));
  assert.ok(
    Object.values(SIC_WACC_MAP).every((name) =>
      industries.industries.some((x) => x.name === name),
    ),
  );
  assert.ok(
    industries.industries.every(
      (x) => Number.isFinite(x.wacc) && x.wacc > 0 && x.wacc < 1,
    ),
  );
});

test('actual local WACC snapshot resolves all three tiers while explicit manual clearing still permits forecasts only', () => {
  const d = data(),
    s = emptySimpleSettings();
  assert.equal(resolveSimpleSettings(d, s, industries).wacc.tier, 'exact');
  d.sic = '7370';
  assert.equal(
    resolveSimpleSettings(d, s, industries).wacc.tier,
    'approximate',
  );
  d.sic = '2080';
  const r = resolveSimpleSettings(d, s, industries);
  assert.equal(r.wacc.tier, 'nonfinancial-market');
  assert.equal(r.parameters.wacc, industries.nonFinancialMarket.wacc * 100);
  d.sic = '6020';
  assert.equal(resolveSimpleSettings(d, s, industries).parameters.wacc, null);
  d.sic = '2080';
  assert.equal(
    resolveSimpleSettings(d, setSimpleOverride(s, 'wacc', null), industries)
      .parameters.wacc,
    null,
  );
});
