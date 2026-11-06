import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FINANCIAL_METRICS,
  type CompanyDetail,
  type FinancialPeriod,
} from '@company-research/shared';
import { CompanyResearchSections } from '../src/analysis/CompanyResearchSections.js';
import { FinancialAnalysis } from '../src/analysis/FinancialAnalysis.js';
import { FinancialTrendChart } from '../src/analysis/FinancialTrendChart.js';
import {
  analysisPeriods,
  analysisValue,
  formatAnalysisValue,
} from '../src/analysis/financial-analysis.js';

function period(
  end: string,
  overrides: Partial<FinancialPeriod> = {},
): FinancialPeriod {
  return {
    ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, null])),
    fiscalYear: Number(end.slice(0, 4)),
    fiscalQuarter: null,
    periodStart: `${end.slice(0, 4)}-01-01`,
    periodEnd: end,
    currency: 'USD',
    ...overrides,
  } as FinancialPeriod;
}
function detail(ticker: string, cik: string): CompanyDetail {
  return {
    ticker,
    cik,
    name: `${ticker} synthetic fixture`,
    id: cik,
    industry: null,
    isFavorite: false,
    financialStatus: 'READY',
    lastFetchedAt: '2026-01-01T00:00:00.000Z',
    financial: null,
    lastError: null,
    annual: [
      period('2025-12-31', {
        revenue: 123000000,
        revenueGrowth: 12,
        eps: 4.5,
        epsGrowth: 10,
        revenueCagr3y: 8,
        epsCagr5y: 9,
        grossProfit: 60000000,
        netIncome: 20000000,
        operatingCashFlow: 30000000,
        capex: 10000000,
        fcf: 20000000,
        roe: 17,
        roa: 8,
        cash: 40000000,
        totalDebt: 20000000,
        netDebt: -20000000,
      }),
    ],
    quarterly: [
      period('2026-06-30', {
        periodStart: '2026-04-01',
        fiscalQuarter: 2,
        revenue: 10000000,
        operatingCashFlow: 5000000,
        capex: 1000000,
        fcf: 4000000,
        roe: 999,
        roa: 999,
        revenueCagr3y: 999,
        epsCagr5y: 999,
      }),
    ],
  };
}
for (const [ticker, cik] of [
  ['GOOG', '0001652044'],
  ['NVDA', '0001045810'],
  ['AAPL', '0000320193'],
]) {
  test(`${ticker}: renders the prescribed single-page module order without the retired financial table`, () => {
    const html = renderToStaticMarkup(
      createElement(CompanyResearchSections, {
        detail: detail(ticker, cik),
        mode: 'annual',
        saving: false,
        onFavorite: () => {},
        onReload: () => {},
        onModeChange: () => {},
      }),
    );
    const markers = [
      '公司基本信息',
      '业务概览',
      'data-analysis-module="growth"',
      'data-analysis-module="profitability"',
      'data-analysis-module="cash-flow"',
      'data-analysis-module="financial-health"',
      '管理层与风险',
      '估值分析',
    ];
    const positions = markers.map((marker) => html.indexOf(marker));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
    );
    assert.ok(
      !html.includes('ant-table-wrapper'),
      'The retired wide financial Table must not render',
    );
    assert.doesNotMatch(html, /全部原始指标|查看选定期间/);
    assert.match(html, /123/);
    assert.match(html, new RegExp(ticker));
    assert.match(html, new RegExp(cik));
    assert.equal((html.match(/待开发/g) ?? []).length, 3);
  });
}
test('selects the latest ten periods without mutating cached arrays or mixing quarterly and annual data', () => {
  const source = detail('GOOG', '0001652044');
  source.annual.unshift(period('2010-12-31'));
  const before = source.annual.map((row) => row.periodEnd);
  assert.equal(analysisPeriods(source, 'annual')[0].periodEnd, '2025-12-31');
  assert.deepEqual(
    source.annual.map((row) => row.periodEnd),
    before,
  );
  assert.equal(
    analysisPeriods(source, 'quarterly')[0].periodStart,
    '2026-04-01',
  );
});
test('quarterly view suppresses unverified ROE/ROA and annual CAGR even if accidentally present in payload', () => {
  const source = detail('NVDA', '0001045810');
  const html = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'quarterly' }),
  );
  assert.doesNotMatch(html, /data-metric="roe"|data-metric="roa"|999/);
  assert.match(html, /2026-04-01 至 2026-06-30/);
  assert.doesNotMatch(html, /2025-12-31/);
  assert.equal(
    analysisValue(source.quarterly[0], 'revenueCagr3y', 'quarterly'),
    null,
  );
});
test('shows missing CapEx/FCF explicitly, preserves true zero, and does not fill latest values from older years', () => {
  const source = detail('NVDA', '0001045810');
  source.annual[0].capex = null;
  source.annual[0].fcf = null;
  source.annual[0].operatingCashFlow = 0;
  source.annual.push(period('2024-12-31', { capex: 100, fcf: 200 }));
  const html = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'annual' }),
  );
  assert.match(html, /CapEx \/ FCF 数据不完整/);
  assert.equal(
    analysisValue(analysisPeriods(source, 'annual')[0], 'capex', 'annual'),
    null,
  );
  assert.equal(formatAnalysisValue(0, 'money'), '0');
  assert.equal(formatAnalysisValue(null, 'money'), '—');
  assert.equal(formatAnalysisValue(-2000000, 'money'), '-2');
  assert.match(html, /仅扣现金/);
});
test('empty history produces module-specific empty states without invalid SVG coordinates', () => {
  const html = renderToStaticMarkup(
    createElement(FinancialAnalysis, {
      detail: { annual: [], quarterly: [] },
      mode: 'annual',
    }),
  );
  assert.match(html, /暂无年度财务数据/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.ok(!html.includes('ant-table-wrapper'));
});
test('trend chart orders dates, preserves null gaps, and renders data-point report periods', () => {
  const rows = [
    period('2025-12-31', { revenue: 3000000 }),
    period('2023-12-31', { revenue: 1000000 }),
    period('2024-12-31', { revenue: null }),
  ];
  const html = renderToStaticMarkup(
    createElement(FinancialTrendChart, {
      rows,
      mode: 'annual',
      unit: 'money',
      title: 'Revenue test',
      series: [{ key: 'revenue', label: 'Revenue', color: '#1677ff' }],
    }),
  );
  assert.equal((html.match(/<circle/g) ?? []).length, 2);
  assert.doesNotMatch(html, /stroke-width="2"/);
  assert.ok(html.indexOf('>2023</text>') < html.indexOf('>2025</text>'));
  assert.match(html, /2025-01-01 至 2025-12-31/);
});
