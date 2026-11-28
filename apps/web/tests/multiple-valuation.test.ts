import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type MultipleInputs } from '@company-research/shared';
import {
  emptyMultipleSettings,
  resolveMultiples,
} from '../src/pages/CompanyDetail/Valuation/MultipleValuation/utils/multiple-valuation-state.js';
import {
  MultipleValuation,
  MultipleValuationResult,
  multipleInputFormatter,
} from '../src/pages/CompanyDetail/Valuation/MultipleValuation/index.js';
import pe from '../src/data/industry-pe-us.json' with { type: 'json' };
import costs from '../src/data/industry-wacc-us.json' with { type: 'json' };
const data = (): MultipleInputs => ({
  version: 1,
  policy: 'pe-peg-v1',
  cik: '0000000001',
  sic: '3571',
  ttm: {
    value: 5,
    start: '2025-01-01',
    end: '2025-12-31',
    sources: [],
    reason: null,
  },
  annual: Array.from({ length: 6 }, (_, i) => ({
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
  })),
  warnings: [],
});
test('shared EPS feeds PE and PEG, with live overrides, manual nulls and default restoration', () => {
  const d = data(),
    s = emptyMultipleSettings(),
    r = resolveMultiples(d, s, pe, costs);
  assert.ok(r.peValue.value! > 0);
  assert.ok(Math.abs(r.pegValue.value! - 50) < 1e-10);
  assert.equal(
    r.industryKe,
    costs.industries.find((x) => x.name === 'Computers/Peripherals')
      ?.costOfEquity,
  );
  const manual = resolveMultiples(
    d,
    {
      ...s,
      epsBasis: 'manual',
      manualEps: 10,
      peMethod: 'manual',
      overrides: { pe: 20 },
      growthMethod: 'manual',
      manualGrowth: 15,
      targetPeg: 1,
    },
    pe,
    costs,
  );
  assert.equal(manual.peValue.value, 200);
  assert.equal(manual.pegValue.value, 150);
  assert.equal(
    resolveMultiples(d, { ...s, peMethod: 'manual' }, pe, costs).peValue.value,
    null,
  );
  assert.equal(
    resolveMultiples(d, { ...s, overrides: { pe: null } }, pe, costs).peValue
      .value,
    null,
  );
  const j = resolveMultiples(
    d,
    { ...s, peMethod: 'justified', overrides: { ke: 10, g: 2, roe: 20 } },
    pe,
    costs,
  );
  assert.ok(Math.abs(j.pe! - 11.475) < 1e-10);
  assert.equal(
    resolveMultiples(
      d,
      { ...s, peMethod: 'justified', overrides: { g: 20, ke: 10 } },
      pe,
      costs,
    ).peValue.value,
    null,
  );
  assert.equal(
    resolveMultiples(d, emptyMultipleSettings(), pe, costs).peValue.value,
    r.peValue.value,
  );
  d.ttm.value = null;
  assert.ok(resolveMultiples(d, s, pe, costs).peValue.value! > 0);
  assert.ok(resolveMultiples(d, s, pe, costs).pegValue.value! > 0);
  assert.ok(
    resolveMultiples(d, { ...s, epsBasis: 'annual' }, pe, costs).peValue
      .value! > 0,
  );
  d.sic = '2080';
  assert.equal(resolveMultiples(d, s, pe, costs).pe, null);
  assert.ok(
    resolveMultiples(d, { ...s, industry: 'Beverage (Soft)' }, pe, costs).pe! >
      0,
  );
  assert.equal(resolveMultiples(null, s, pe, costs).peValue.value, null);
});
test('EPS availability defaults, explicit selection and restoring defaults preserve latest-period policy', () => {
  const d = data(),
    defaults = emptyMultipleSettings();
  assert.equal(defaults.epsBasis, undefined);
  assert.equal(resolveMultiples(d, defaults, pe, costs).epsBasis, 'ttm');
  d.ttm.value = null;
  const fallback = resolveMultiples(d, defaults, pe, costs);
  assert.equal(fallback.epsBasis, 'annual');
  assert.equal(fallback.eps, d.annual[0].eps.value);
  assert.match(fallback.epsSelectionReason, /FY2025/);
  assert.match(fallback.epsSelectionReason, /TTM/);
  const explicit = { ...defaults, epsBasis: 'ttm' as const };
  assert.equal(resolveMultiples(d, explicit, pe, costs).eps, null);
  assert.equal(resolveMultiples(d, explicit, pe, costs).epsBasis, 'ttm');
  assert.equal(
    resolveMultiples(d, emptyMultipleSettings(), pe, costs).epsBasis,
    'annual',
  );
  d.ttm.value = 8;
  assert.equal(
    resolveMultiples(d, { ...defaults, epsBasis: 'annual' }, pe, costs).eps,
    d.annual[0].eps.value,
  );
  assert.equal(
    resolveMultiples(
      d,
      { ...defaults, epsBasis: 'manual', manualEps: 0 },
      pe,
      costs,
    ).eps,
    0,
  );
  assert.equal(
    resolveMultiples(
      d,
      { ...defaults, epsBasis: 'manual', manualEps: 0 },
      pe,
      costs,
    ).peValue.value,
    null,
  );
  d.ttm.value = 0;
  assert.equal(resolveMultiples(d, defaults, pe, costs).epsBasis, 'annual');
  d.annual[0].eps.value = null;
  assert.equal(resolveMultiples(d, defaults, pe, costs).eps, null);
  assert.equal(resolveMultiples(d, defaults, pe, costs).peValue.value, null);
  assert.match(
    resolveMultiples(d, defaults, pe, costs).epsSelectionReason,
    /均缺失或非正/,
  );
});
test('missing numeric values render empty while explicit zero, negatives and typing retain their meaning', () => {
  const idle = { userTyping: false, input: '' };
  for (const value of [null, undefined, '', ' ', NaN, Infinity])
    assert.equal(multipleInputFormatter(value, idle), '');
  assert.equal(multipleInputFormatter(0, idle), '0.00');
  assert.equal(multipleInputFormatter('0', idle), '0.00');
  assert.equal(multipleInputFormatter(-12.5, idle), '-12.50');
  assert.equal(multipleInputFormatter(1234.567, idle), '1,234.57');
  assert.equal(
    multipleInputFormatter(null, { userTyping: true, input: '0.' }),
    '0.',
  );
  const d = data(),
    s = emptyMultipleSettings();
  d.sic = '2080';
  d.annual = [];
  const r = resolveMultiples(d, s, pe, costs);
  assert.equal(r.industryPe, null);
  assert.equal(r.industryKe, null);
  assert.equal(r.growth, null);
  assert.equal(r.inputs.roe, null);
  for (const value of [r.pe, r.inputs.ke, r.inputs.roe, r.growth])
    assert.equal(multipleInputFormatter(value, idle), '');
  assert.equal(
    resolveMultiples(d, { ...s, overrides: { pe: 0 } }, pe, costs).pe,
    0,
  );
});
test('compact modules render shared EPS, method selectors, formula results and reset without charts or market prices', () => {
  const html = renderToStaticMarkup(
    createElement(MultipleValuation, { ticker: 'TEST' }),
  );
  for (const label of [
    'PE Valuation',
    'PEG Valuation',
    'PE和PEG共用EPS基准',
    'PE估值方法',
    'EPS增长率方法',
    'Target PEG',
    '每股估值',
    '合理市盈率',
    '恢复默认',
  ])
    assert.ok(html.includes(label), label);
  assert.ok(!html.includes('financial-trend-chart'));
  assert.ok(!html.includes('当前股价'));
  const epsStart = html.indexOf('aria-label="共用EPS基准"');
  const peStart = html.indexOf('aria-label="PE估值"');
  const pegStart = html.indexOf('aria-label="PEG估值"');
  assert.ok(epsStart >= 0 && epsStart < peStart && peStart < pegStart);
  assert.equal((html.match(/PE和PEG共用EPS基准/g) ?? []).length, 1);
  assert.ok(!html.slice(peStart).includes('Diluted EPS'));
  assert.ok(!html.includes('共用稀释EPS基准'));
  assert.ok(
    html.indexOf('aria-label="PE估值方法"') <
      html.indexOf('aria-label="PE行业选择"'),
  );
  assert.ok(
    html.indexOf('aria-label="PE行业选择"') <
      html.indexOf('aria-label="Industry PE"'),
  );
  assert.ok(
    html.indexOf('aria-label="EPS增长率方法"') <
      html.indexOf('aria-label="EPS Growth"'),
  );
  assert.ok(
    html.indexOf('aria-label="EPS Growth"') <
      html.indexOf('aria-label="Target PEG"'),
  );
  assert.equal(
    (html.match(/class="multiple-valuation-result"/g) ?? []).length,
    2,
  );
  assert.equal((html.match(/ant-divider-horizontal/g) ?? []).length, 2);
  assert.ok(!html.includes('合理PE：'));
  assert.ok(!html.includes('每股估值：'));
  assert.ok(!html.includes('基准选择'));
  assert.ok(!html.includes('报告期间'));
  assert.ok(!html.slice(epsStart, peStart).includes('最新完整财年'));
  assert.ok(!html.includes('TTM 不可用'));
  assert.ok(!html.includes('Fair Value = EPS'));
  assert.ok(!html.includes('multiple-valuation-formula'));
  assert.ok(html.includes('multiple-valuation-eps-row'));
  assert.ok(html.includes('multiple-valuation-field'));
  assert.ok(!html.includes('multiple-valuation-result-safety'));
  assert.equal((html.match(/class="margin-of-safety-table"/g) ?? []).length, 2);
  assert.equal((html.match(/ant-col-12(?:\s|")/g) ?? []).length, 4);
  assert.ok((html.match(/ant-col-sm-8/g) ?? []).length >= 6);
  assert.ok(!html.includes('flex:0 0 240px'));
});
test('shared result presentation emphasizes one price and keeps substituted calculations inside the tooltip', () => {
  const html = renderToStaticMarkup(
    createElement(MultipleValuationResult, {
      fairPe: 26.0559056836,
      fairValue: 281.66434044,
      formula: 'Fair Value = EPS × Fair PE',
      detail: '10.81 × 26.06 ≈ 281.66',
    }),
  );
  assert.ok(html.includes('multiple-valuation-fair-value">$281.66'));
  assert.equal((html.match(/281.66/g) ?? []).length, 1);
  assert.ok(html.includes('26.06x'));
  assert.ok(!html.includes('10.81 ×'));
  assert.ok(!html.includes('Fair Value = EPS'));
  assert.ok(!html.includes('multiple-valuation-formula'));
  const missing = renderToStaticMarkup(
    createElement(MultipleValuationResult, {
      fairPe: null,
      fairValue: null,
      formula: 'Fair Value = EPS × Fair PE',
      detail: '缺失',
    }),
  );
  assert.ok(missing.includes('multiple-valuation-fair-value">—'));
  assert.ok(!missing.includes('0.00'));
});
