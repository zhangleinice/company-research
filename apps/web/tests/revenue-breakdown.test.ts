import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatRevenueMillions,
  RevenueTables,
} from '../src/RevenueBreakdown.js';
import type { RevenueBreakdownResponse } from '@company-research/shared';
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
        facts: [fact],
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
  assert.ok(html.includes('25.00%'));
  assert.ok(html.includes('百万美元'));
  assert.ok(html.includes('—'));
  assert.ok(html.includes('#fact'));
  assert.ok(html.includes('Total revenues'));
  assert.ok(!html.includes('Original disclosure'));
});
