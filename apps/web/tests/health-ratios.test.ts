import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import {
  FINANCIAL_METRICS,
  type FinancialPeriod,
} from '@company-research/shared';
import {
  FinancialRatioChart,
  financialRatioSeries,
} from '../src/analysis/FinancialRatioChart.js';
import { FinancialAnalysis } from '../src/analysis/FinancialAnalysis.js';
import { formatAnalysisValue } from '../src/analysis/financial-analysis.js';
const row = (
  year: number,
  overrides: Partial<FinancialPeriod> = {},
): FinancialPeriod =>
  ({
    ...Object.fromEntries(FINANCIAL_METRICS.map((k) => [k, null])),
    fiscalYear: year,
    fiscalQuarter: null,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    currency: 'USD',
    ...overrides,
  }) as FinancialPeriod;
test('six ordered health cards keep help icons and no redundant detail areas', () => {
  for (const mode of ['annual', 'quarterly'] as const) {
    const r = row(2025, {
      netDebt: -50000000,
      interestCoverage: 12.5,
      currentRatio: 2,
      debtToEquity: 0.5,
    });
    const html = render(
      createElement(FinancialAnalysis, {
        detail: {
          annual: [r],
          quarterly: [{ ...r, fiscalQuarter: 4, periodStart: '2025-10-01' }],
        },
        mode,
        modules: ['financial-health'],
      }),
    );
    const keys = [
      'cashAndShortTermSecurities',
      'totalDebt',
      'netDebt',
      'currentRatio',
      'debtToEquity',
      'interestCoverage',
    ];
    const positions = keys.map((k) => html.indexOf(`data-metric="${k}"`));
    assert.ok(positions.every((x) => x >= 0));
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
    assert.equal((html.match(/class="metric-help"/g) ?? []).length, 6);
    assert.match(html, /-50/);
    assert.match(html, /12.50x/);
    assert.match(html, /Cash &amp; Debt Trends/);
    assert.match(html, /Financial Ratio Trends/);
    assert.doesNotMatch(html, /<table|ant-collapse|缺失原因列表/);
  }
});
test('ratio chart filters independently, preserves ten periods and disconnected loss points', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    row(2016 + i, { currentRatio: 2, debtToEquity: 1 }),
  );
  rows[0].interestCoverage = -3;
  rows[9].interestCoverage = 200;
  const html = render(
    createElement(FinancialRatioChart, { rows, mode: 'annual' }),
  );
  assert.equal((html.match(/data-period-end=/g) ?? []).length, 10);
  assert.equal((html.match(/<circle[^>]*fill="#d89614"/g) ?? []).length, 2);
  assert.equal((html.match(/<line[^>]*stroke="#d89614"/g) ?? []).length, 0);
  assert.match(html, /Interest Coverage: -3.00x/);
  assert.match(html, /200.00x/);
  for (const key of [
    'currentRatio',
    'debtToEquity',
    'interestCoverage',
  ] as const)
    assert.deepEqual(
      financialRatioSeries(key).map((x) => x.key),
      [key],
    );
  assert.equal(formatAnalysisValue(null, 'multiple'), '—');
  assert.equal(formatAnalysisValue(0, 'multiple'), '0.00x');
});
test('all-missing interest coverage does not remove other financial ratios', () => {
  const rows = [
    row(2025, { currentRatio: 2, debtToEquity: 1, interestCoverage: null }),
  ];
  const html = render(
    createElement(FinancialRatioChart, { rows, mode: 'annual' }),
  );
  assert.equal((html.match(/<circle/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Interest Coverage: 0/);
});
