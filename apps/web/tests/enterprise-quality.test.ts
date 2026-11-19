import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  EnterpriseQuality,
  ValuationFact,
} from '@company-research/shared';
import { QualityAnalysis } from '../src/EnterpriseQuality.js';
import { fetchEnterpriseQuality } from '../src/api.js';
afterEach(() => mock.restoreAll());
const missing: ValuationFact = {
  value: null,
  start: null,
  end: '',
  concept: null,
  items: [],
};
const data: EnterpriseQuality = {
  version: 1,
  ticker: 'TEST',
  cik: '0000000001',
  start: '2025-10-01',
  asOf: '2026-09-30',
  applicable: true,
  netIncome: { ...missing, value: 123e6 },
  commonNetIncome: missing,
  depreciationAmortization: missing,
  depreciation: missing,
  amortization: missing,
  capex: { ...missing, value: 0 },
  ebit: { ...missing, value: 200e6 },
  taxExpense: missing,
  pretaxIncome: missing,
  historicalTaxRate: null,
  capital: [],
};
test('quality keeps all five analyses and complete formulas visible with unknown inputs and results', () => {
  const html = renderToStaticMarkup(createElement(QualityAnalysis, { data }));
  for (const label of [
    '股东盈余',
    '投入资本回报率',
    '维持性资本支出',
    '竞争优势',
    '管理层资本配置能力',
    'Owner Earnings ≈',
    'ROIC = NOPAT',
    'NOPAT = EBIT',
    '历史有效税率',
    '123',
    '未完整核准',
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /123 \+ — − — − — = —/);
  assert.ok(!html.includes('<input'));
  assert.ok(!html.includes('ant-alert'));
  assert.equal((html.match(/待研究/g) ?? []).length, 2);
  assert.ok(!html.includes('NaN'));
});
test('historical ETR is labelled separately from the unapproved NOPAT rate and explicit zero remains zero', () => {
  const html = renderToStaticMarkup(
    createElement(QualityAnalysis, { data: { ...data, historicalTaxRate: 0 } }),
  );
  assert.ok(html.includes('0.00% · 已计算，非NOPAT适用税率'));
  assert.ok(html.includes('200 × (1 − —) = —'));
});
test('quality requests only the cache endpoint and forwards cancellation', async () => {
  const controller = new AbortController();
  const f = mock.method(
    globalThis,
    'fetch',
    async (_url: string, init?: RequestInit) => {
      assert.equal(init?.signal, controller.signal);
      return new Response(JSON.stringify(data));
    },
  );
  assert.deepEqual(
    await fetchEnterpriseQuality('A&B', controller.signal),
    data,
  );
  assert.equal(
    f.mock.calls[0].arguments[0],
    '/api/companies/A%26B/valuation/quality',
  );
  assert.equal(f.mock.callCount(), 1);
});
