import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EvComposition,
  evComposition,
} from '../src/pages/CompanyDetail/Valuation/DCF/components/EvComposition.js';
import { calculateDcf } from '@company-research/shared';
import {
  calculatorInput,
  initialScenario,
} from '../src/pages/CompanyDetail/Valuation/DCF/utils/valuation-calculator.js';
import {
  emptyEquityBridge,
  type ValuationBaseline,
} from '@company-research/shared';

test('composition uses the two present-value components, rejecting missing, nonfinite, signed or inconsistent totals', () => {
  assert.deepEqual(evComposition(27.21, 72.79, 100), {
    forecast: 27.21,
    terminal: 72.79,
  });
  assert.deepEqual(evComposition(0, 100, 100), { forecast: 0, terminal: 100 });
  for (const inputs of [
    [null, 100, 100],
    [20, undefined, 100],
    [20, 80, null],
    [0, 0, 0],
    [-20, 120, 100],
    [120, -20, 100],
    [-10, -90, -100],
    [20, 80, 120],
    [NaN, 100, 100],
    [20, Infinity, 100],
    [20, 80, Infinity],
  ] as const) {
    assert.equal(
      evComposition(inputs[0], inputs[1], inputs[2]),
      null,
      String(inputs),
    );
  }
});
test('small or zero proportions use outside labels; invalid totals never paint a 100% bar', () => {
  const small = renderToStaticMarkup(
    createElement(EvComposition, { firstFive: 1, terminalPV: 99, ev: 100 }),
  );
  assert.ok(small.includes('has-small-share'));
  assert.ok(small.includes('width:1%'));
  assert.ok(small.includes('width:99%'));
  assert.ok(small.includes('1.00%'));
  assert.ok(small.includes('第1～5年'));
  assert.ok(small.includes('第6年～永续'));
  assert.ok(!small.includes('百万美元'));
  const missing = renderToStaticMarkup(
    createElement(EvComposition, {
      firstFive: null,
      terminalPV: null,
      ev: null,
    }),
  );
  assert.ok(!missing.includes('role="img"'));
  assert.ok(!missing.includes('width:'));
});
test('composition follows the existing DCF engine results and changes with WACC without mixing TV with PV(TV)', () => {
  const missing = {
    value: null,
    start: null,
    end: '',
    concept: null,
    items: [],
  };
  const baseline: ValuationBaseline = {
    ticker: 'TEST',
    cik: '0000000001',
    name: null,
    asOf: '',
    checkedAt: '',
    applicable: true,
    status: 'REVIEW_REQUIRED',
    warnings: [],
    revenue: missing,
    ebit: missing,
    ocf: missing,
    capex: missing,
    interest: missing,
    fcf: null,
    fcff: 100e6,
  };
  const compute = (wacc: number) =>
    calculateDcf(
      calculatorInput(baseline, {
        ...initialScenario,
        wacc,
        useResearch: false,
        researchValue: null,
        researchReason: '',
        bridge: emptyEquityBridge(),
      }),
    );
  const first = compute(10),
    second = compute(11);
  const firstFive = first.rows.reduce((sum, row) => sum + row.pv, 0);
  const parts = evComposition(firstFive, first.terminalPV, first.ev)!;
  assert.ok(Math.abs(parts.forecast + parts.terminal - 100) < 1e-10);
  assert.notEqual(first.terminalPV, first.terminalValue);
  assert.equal(evComposition(firstFive, first.terminalValue, first.ev), null);
  assert.notEqual(
    parts.terminal,
    evComposition(
      second.rows.reduce((sum, row) => sum + row.pv, 0),
      second.terminalPV,
      second.ev,
    )!.terminal,
  );
});
