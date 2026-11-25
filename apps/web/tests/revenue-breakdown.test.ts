import { FinancialAnalysis } from '../src/analysis/FinancialAnalysis.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatRevenueMillions,
  RevenueTables,
} from '../src/RevenueBreakdown.js';
import {
  FINANCIAL_METRICS,
  type FinancialPeriod,
  type RevenueBreakdownResponse,
} from '@company-research/shared';
test('formats exact amounts without converting large USD integers to floating point', () => {
  assert.equal(
    formatRevenueMillions('9007199254740993123456'),
    '9,007,199,254,740,993.123456',
  );
  assert.equal(formatRevenueMillions('-127000000'), '-127');
  assert.equal(formatRevenueMillions('0'), '0');
  assert.equal(formatRevenueMillions(null), '—');
});
test('keeps original groups, totals, missing years, percent growth and SEC links; hides empty results', () => {
  const empty: RevenueBreakdownResponse = {
    status: 'EMPTY',
    accessionNumber: 'filing',
    sourceUrl: 'https://www.sec.gov/Archives/test',
    fiscalYear: 2025,
    extractedAt: null,
    groups: [],
  };
  assert.equal(
    renderToStaticMarkup(createElement(RevenueTables, { data: empty })),
    '',
  );
  const fact = {
    value: '100000000',
    fiscalYear: 2025,
    unit: 'USD' as const,
    concept: 'revenue',
    accessionNumber: 'filing',
    sourceUrl: empty.sourceUrl!,
    factUrl: empty.sourceUrl! + '#fact',
    context: {
      id: 'c',
      cik: '0001652044',
      start: '2025-01-01',
      end: '2025-12-31',
      dimensions: [],
    },
    yoy: { value: 25, reason: 'same row' },
  };
  const group = {
    tableIndex: 1,
    tableId: null,
    header: 'Original disclosure',
    sourceUrl: empty.sourceUrl!,
    accessionNumber: 'filing',
    rows: [
      {
        rowIndex: 1,
        name: 'Official item',
        originalRow: 'Original row',
        facts: [
          { ...fact, fiscalYear: 2023, value: '64000000' },
          { ...fact, fiscalYear: 2024, value: '80000000' },
          fact,
        ],
      },
      {
        rowIndex: 2,
        name: 'Total revenues',
        originalRow: 'Total row',
        facts: [],
      },
    ],
  };
  const data = {
    ...empty,
    status: 'READY',
    groups: [group, { ...group, tableIndex: 2 }],
  };
  const html = renderToStaticMarkup(createElement(RevenueTables, { data }));
  assert.equal((html.match(/ant-table-wrapper/g) || []).length, 2);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="collapsed"/);
  assert.ok(html.includes('25.00%'));
  assert.ok(html.includes('百万美元'));
  assert.ok(html.includes('—'));
  assert.ok(html.includes('#fact'));
  assert.ok(html.includes('Total revenues'));
  assert.ok(!html.includes('Original disclosure'));
  assert.ok(!html.includes('ant-card'));
  const before = JSON.stringify(data);
  for (const mode of ['annual', 'quarterly'] as const) {
    const row = {
      ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, null])),
      fiscalYear: 2025,
      fiscalQuarter: mode === 'annual' ? null : 4,
      periodStart: mode === 'annual' ? '2025-01-01' : '2025-10-01',
      periodEnd: '2025-12-31',
      currency: 'USD',
      revenue: 100000000,
    } as FinancialPeriod;
    const page = renderToStaticMarkup(
      createElement(FinancialAnalysis, {
        detail: { annual: [row], quarterly: [row] },
        mode,
        modules: ['growth', 'profitability', 'cash-flow'],
        growthDetails: createElement(RevenueTables, { data }),
      }),
    );
    const growth = page.slice(
      page.indexOf('data-analysis-module="growth"'),
      page.indexOf('data-analysis-module="profitability"'),
    );
    assert.ok(
      growth.includes(html),
      'the complete revenue component stays inside Growth',
    );
    assert.ok(
      growth.indexOf('Revenue / EPS 同比趋势') < growth.indexOf('收入明细'),
    );
    for (const year of [2023, 2024, 2025])
      assert.ok(growth.includes(String(year)));
    for (const metric of [
      'revenue',
      'revenueGrowth',
      'eps',
      'epsGrowth',
      'revenueCagr3y',
      'revenueCagr5y',
      'epsCagr3y',
      'epsCagr5y',
    ])
      assert.ok(growth.includes(`data-metric="${metric}"`));
    assert.equal(
      (page.match(/aria-label="Revenue Breakdown · 收入明细"/g) ?? []).length,
      1,
    );
  }
  const noFinancials = renderToStaticMarkup(
    createElement(FinancialAnalysis, {
      detail: { annual: [], quarterly: [] },
      mode: 'annual',
      modules: ['growth'],
      growthDetails: createElement(RevenueTables, { data }),
    }),
  );
  assert.ok(
    noFinancials.includes(html),
    'revenue disclosure remains available when financial history is missing',
  );
  assert.equal(JSON.stringify(data), before);
});
