import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  targetBuyPrice,
  peValue,
  type MultipleYear,
} from '@company-research/shared';
import { Card, Tabs, type TabsProps } from 'antd';
import { MarginOfSafety } from '../src/MarginOfSafety.js';
import { IntrinsicValuation } from '../src/IntrinsicValuation.js';
import {
  emptyMultipleSettings,
  resetPeSettings,
  resetPegSettings,
} from '../src/multiple-valuation-state.js';
import { emptySimpleSettings } from '../src/simple-valuation-state.js';
import {
  valuationNumber,
  valuationPercent,
  multipleValueFormula,
  justifiedPeFormula,
  epsCagrFormula,
} from '../src/valuation-format.js';
test('target price accepts 0 to less than 100 percent, keeps precision, and rejects missing/nonpositive valuations', () => {
  assert.equal(targetBuyPrice(100, 30), 70);
  assert.equal(targetBuyPrice(100, 0), 100);
  assert.ok(targetBuyPrice(100, 99.999)! > 0);
  for (const x of [-1, 100, 101, NaN, Infinity, null])
    assert.equal(targetBuyPrice(100, x), null);
  for (const x of [0, -1, NaN, Infinity, null])
    assert.equal(targetBuyPrice(x, 30), null);
  assert.equal(
    targetBuyPrice(123.456789, 12.3456),
    123.456789 * (1 - 12.3456 / 100),
  );
  assert.notEqual(targetBuyPrice(1.005, 30), targetBuyPrice(1.01, 30));
});
test('model settings and resets no longer carry editable safety assumptions', () => {
  const dcf = emptySimpleSettings();
  const both = {
    ...emptyMultipleSettings(),
    manualGrowth: 15,
    growthMethod: 'manual' as const,
    targetPeg: 2,
  };
  assert.ok(!('marginOfSafety' in dcf));
  for (const s of [both, resetPeSettings(both), resetPegSettings(both)]) {
    assert.ok(!('peSafety' in s));
    assert.ok(!('pegSafety' in s));
  }
  assert.equal(resetPeSettings(both).manualGrowth, 15);
  assert.equal(resetPegSettings(both).targetPeg, 1);
});
test('shared safety reference table includes row labels and four fixed ratios, recomputes from value and has no inputs', () => {
  const view = (fairValue: number | null, model: 'DCF' | 'PE' | 'PEG' = 'PE') =>
    renderToStaticMarkup(createElement(MarginOfSafety, { model, fairValue }));
  const html = view(100);
  assert.equal((html.match(/<tr>/g) ?? []).length, 2);
  assert.equal((html.match(/<td/g) ?? []).length, 4);
  for (const ratio of ['20%', '30%', '40%', '50%'])
    assert.ok(html.includes(ratio));
  for (const price of ['80.00', '70.00', '60.00', '50.00'])
    assert.ok(html.includes(price));
  for (const model of ['DCF', 'PE', 'PEG'] as const) {
    const next = view(200, model);
    for (const price of ['160.00', '140.00', '120.00', '100.00'])
      assert.ok(next.includes(price));
    assert.ok(next.includes(model + '安全边际'));
  }
  for (const value of [null, 0, -1, NaN, Infinity])
    assert.equal((view(value).match(/<td[^>]*>—<\/td>/g) ?? []).length, 4);
  assert.ok(view(123.456789).includes('98.77'));
  assert.ok(!html.includes('<input'));
  assert.ok(!html.includes('<button'));
  assert.ok(!html.includes('ant-card'));
  assert.ok(!html.includes('background'));
  assert.ok(!html.includes('每股估值'));
  assert.ok(html.includes('margin-of-safety-table'));
  assert.ok(!html.includes('ⓘ'));
  assert.ok(!html.includes('Margin of Safety ·'));
  assert.equal((html.match(/<th /g) ?? []).length, 6);
  assert.ok(html.includes('<th scope="row">安全边际</th>'));
  assert.ok(html.includes('<th scope="row">参考买入价</th>'));
  assert.ok(!html.includes('dcf-parameter-label'));
  assert.ok(html.includes('table-layout:fixed'));
});
test('intrinsic tabs default to DCF, use stable pane keys and keep visited modules mounted', () => {
  const node = IntrinsicValuation({ cik: '0000000001', ticker: 'TEST' });
  const props = node.props as TabsProps;
  assert.equal(node.type, Tabs);
  assert.equal(node.props.defaultActiveKey, 'dcf');
  assert.equal(node.props.destroyOnHidden, false);
  assert.deepEqual(
    props.items!.map((x) => x.key),
    ['owner', 'dcf', 'multiples'],
  );
  assert.deepEqual(
    props.items!.map((x) => x.label),
    ['Owner Earnings', 'DCF', 'PE & PEG'],
  );
  const multiples = props.items![2].children;
  assert.ok(isValidElement<{ title?: string; className?: string }>(multiples));
  assert.equal(multiples.type, Card);
  assert.equal(multiples.props.title, undefined);
  assert.equal(multiples.props.className, 'valuation-card');
  const html = renderToStaticMarkup(node);
  assert.match(html, /aria-selected="true"[^>]*>[\s\S]*?DCF/);
  assert.ok(html.includes('现金流折现'));
  assert.ok(!html.includes('Historical Financial Data')); // lazy initial pane: no Owner Earnings request until visited
});
test('display formatting rounds only presentation, including substituted PE/PEG/CAGR and justified PE parameters', () => {
  assert.equal(valuationNumber(0), '0.00');
  assert.equal(valuationNumber(-1234.5), '-1,234.50');
  assert.equal(valuationNumber(null), '—');
  assert.equal(valuationPercent(2), '2.00%');
  const raw = peValue(10.81, 26.05590568363997);
  assert.equal(raw.value, 10.81 * 26.05590568363997);
  assert.equal(
    multipleValueFormula(10.81, 26.05590568363997, raw.value),
    '10.81 × 26.06 ≈ 281.66 美元/股',
  );
  assert.ok(
    justifiedPeFormula(32.06932403, 2, 8.801837329, 14.06072744).includes(
      '8.80%',
    ),
  );
  assert.ok(
    !justifiedPeFormula(32.06932403, 2, 8.801837329, 14.06072744).includes(
      '8.801837329',
    ),
  );
  const ys = [
    { year: 2025, end: '2025-12-31', eps: { value: 10.81 } },
    { year: 2024, end: '2024-12-31', eps: { value: 8.04 } },
    { year: 2023, end: '2023-12-31', eps: { value: 5.8 } },
    { year: 2022, end: '2022-12-31', eps: { value: 4.56 } },
  ] as MultipleYear[];
  assert.ok(epsCagrFormula(ys, 3, 0.3333790189).includes('33.34%'));
  assert.ok(epsCagrFormula(ys, 3, 0.3333790189).includes('4.56'));
  assert.equal(raw.value, 10.81 * 26.05590568363997);
});
