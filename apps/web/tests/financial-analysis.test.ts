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
  METRICS,
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
      '业务概述',
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
    assert.equal((html.match(/待开发/g) ?? []).length, 1);
    assert.equal((html.match(/>更新数据</g) ?? []).length, 1);
    assert.doesNotMatch(html, /查看原文证据|重新生成|检查最新年报/);
    assert.match(html, /ant-space-vertical/);
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

test('Growth series selection changes only plotted metrics and defaults to comparison', async () => {
  const { growthSeries } = await import('../src/GrowthChart.js');
  assert.deepEqual(
    growthSeries('both').map((x) => x.key),
    ['revenueGrowth', 'epsGrowth'],
  );
  assert.deepEqual(
    growthSeries('revenue').map((x) => x.key),
    ['revenueGrowth'],
  );
  assert.deepEqual(
    growthSeries('eps').map((x) => x.key),
    ['epsGrowth'],
  );
});

test('Profitability selectors preserve comparison default and independently select each metric', async () => {
  const { profitabilitySeries } =
    await import('../src/analysis/ProfitabilityCharts.js');
  for (const kind of ['margin', 'profit'] as const) {
    const all = profitabilitySeries(kind, 'all');
    assert.equal(all.length, 3);
    for (const [index, selected] of (
      ['gross', 'operating', 'net'] as const
    ).entries()) {
      assert.deepEqual(profitabilitySeries(kind, selected), [all[index]]);
    }
  }
});

test('Profitability charts display negative profits in hundred-million USD and preserve gaps', () => {
  const html = renderToStaticMarkup(
    createElement(FinancialTrendChart, {
      rows: [
        period('2023-12-31', { grossProfit: -123456789 }),
        period('2024-12-31'),
        period('2025-12-31', { grossProfit: 2e8 }),
      ],
      mode: 'annual',
      unit: 'money',
      title: '利润',
      moneyDivisor: 1e8,
      moneyUnit: '亿美元',
      series: [{ key: 'grossProfit', label: 'Gross Profit', color: '#1677ff' }],
    }),
  );
  assert.match(html, /亿美元/);
  assert.match(html, /-123,456,789 USD/);
  assert.match(html, /2023-01-01 至 2023-12-31/);
  assert.doesNotMatch(html, /NaN|Infinity|stroke-width="2"/);
});

test('cash flow chart selectors independently show the selected series without fetching', async () => {
  const { cashFlowSeries } = await import('../src/analysis/CashFlowCharts.js');
  assert.deepEqual(
    cashFlowSeries('cash', 'all').map((x) => x.key),
    ['operatingCashFlow', 'capex', 'fcf'],
  );
  assert.deepEqual(
    cashFlowSeries('quality', 'all').map((x) => x.key),
    ['netIncome', 'operatingCashFlow'],
  );
  for (const selected of ['operatingCashFlow', 'capex', 'fcf'] as const) {
    assert.deepEqual(
      cashFlowSeries('cash', selected).map((x) => x.key),
      [selected],
    );
  }
  for (const selected of ['netIncome', 'operatingCashFlow'] as const) {
    assert.deepEqual(
      cashFlowSeries('quality', selected).map((x) => x.key),
      [selected],
    );
  }
});

test('CapEx / OCF is an auxiliary backend value with null-safe formatting in both modes', () => {
  const source = detail('GOOG', '0001652044');
  source.annual[0].capexToOcf = 55.519;
  source.quarterly[0].capexToOcf = 0;
  const annual = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'annual' }),
  );
  const quarterly = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'quarterly' }),
  );
  assert.match(annual, /data-metric="capexToOcf">55.52%/);
  assert.match(quarterly, /data-metric="capexToOcf">0.00%/);
  delete source.annual[0].capexToOcf;
  const missing = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'annual' }),
  );
  assert.match(missing, /data-metric="capexToOcf">—/);
  // Frontend must not invent a ratio even though this fixture still has CapEx and OCF.
  assert.equal(analysisValue(source.annual[0], 'capexToOcf', 'annual'), null);
});

test('cash flow charts show negative values, exact USD tooltips and null gaps', () => {
  const html = renderToStaticMarkup(
    createElement(FinancialTrendChart, {
      rows: [
        period('2023-12-31', { operatingCashFlow: -2e8 }),
        period('2024-12-31'),
        period('2025-12-31', { operatingCashFlow: 3e8 }),
      ],
      mode: 'annual',
      unit: 'money',
      title: 'OCF',
      moneyDivisor: 1e8,
      moneyUnit: '亿美元',
      series: [{ key: 'operatingCashFlow', label: 'OCF', color: '#1677ff' }],
    }),
  );
  assert.match(html, /-200,000,000 USD/);
  assert.match(html, /2023-01-01 至 2023-12-31/);
  assert.match(html, /亿美元/);
  assert.doesNotMatch(html, /NaN|Infinity|stroke-width="2"/);
});

test('health chart selects cash/debt independently and defaults to comparison', async () => {
  const { healthSeries } =
    await import('../src/analysis/FinancialHealthChart.js');
  assert.deepEqual(
    healthSeries('all').map((x) => x.key),
    ['cash', 'totalDebt'],
  );
  for (const key of ['cash', 'totalDebt'] as const)
    assert.deepEqual(
      healthSeries(key).map((x) => x.key),
      [key],
    );
});
test('health auxiliary metrics display only API evidence, preserve negative adjusted debt and suppress absent evidence', () => {
  const source = detail('GOOG', '0001652044');
  source.annual[0].cashAndShortTermSecurities = 126843e6;
  source.annual[0].netDebtAfterLiquidAssets = -78300e6;
  const html = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'annual' }),
  );
  assert.match(html, /data-metric="cashAndShortTermSecurities">126,843/);
  assert.match(html, /data-metric="netDebtAfterLiquidAssets">-78,300/);
  assert.match(html, /Net Debt（仅扣现金）/);
  const quarter = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: source, mode: 'quarterly' }),
  );
  assert.match(quarter, /data-metric="cashAndShortTermSecurities">—/);
});

test('shareholder returns appear in their own fifth module with share units and explicit missing values', () => {
  const company = detail('GOOG', '0001652044');
  company.annual[0].dilutedShares = 12230000000;
  company.annual[0].dilutedSharesGrowth = -1.743391982;
  company.annual[0].stockRepurchases = 45709000000;
  const html = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: company, mode: 'annual' }),
  );
  assert.equal((html.match(/data-metric="stockRepurchases"/g) ?? []).length, 1);
  assert.equal((html.match(/data-metric="dividendsPaid"/g) ?? []).length, 1);
  assert.ok(html.includes('Shareholder Returns'));
  assert.ok(html.includes('Diluted Shares Trend'));
  assert.ok(html.includes('12,230'));
  assert.ok(html.includes('百万股'));
  assert.ok(html.includes('-1.74%'));
  assert.equal(formatAnalysisValue(null, 'shares'), '—');
  assert.equal(formatAnalysisValue(12230000000, 'shares'), '12,230');
});

test('GOOGL dividend analysis labels declared DPS separately from cash payments and zero from missing', () => {
  const company = detail('GOOGL', '0001652044');
  company.annual = [
    period('2023-12-31', { dividendsPerShare: 0, dpsGrowth: null }),
    period('2024-12-31', { dividendsPerShare: 0.6, dpsGrowth: null }),
    period('2025-12-31', { dividendsPerShare: 0.83, dpsGrowth: 38.33333333 }),
  ];
  const html = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: company, mode: 'annual' }),
  );
  assert.ok(html.includes('Dividends Per Share Trend'));
  assert.ok(html.includes('38.33%'));
  assert.ok(html.includes('Declared DPS: 0'));
  assert.ok(html.includes('Declared DPS: 0.83'));
  assert.ok(METRICS.dividendsPaid.description.includes('实际支付'));
  assert.ok(METRICS.dividendsPerShare.description.includes('已宣告'));
  assert.ok(!html.includes('回购金额不等于回购股数'));
  assert.ok(!html.includes('DPS 为普通股已宣告每股股息'));
  assert.equal((html.match(/data-metric="dividendsPaid"/g) ?? []).length, 1);
  assert.equal(
    (html.match(/data-metric="dividendsPerShare"/g) ?? []).length,
    1,
  );
  company.annual[0].dividendsPerShare = null;
  const missing = renderToStaticMarkup(
    createElement(FinancialAnalysis, { detail: company, mode: 'annual' }),
  );
  assert.ok(!missing.includes('2023-01-01 至 2023-12-31 · Declared DPS:'));
});

test('five modules keep shareholder metrics and charts outside Cash Flow in both modes', () => {
  for (const mode of ['annual', 'quarterly'] as const) {
    const html = renderToStaticMarkup(
      createElement(FinancialAnalysis, {
        detail: detail('GOOGL', '0001652044'),
        mode,
      }),
    );
    assert.equal((html.match(/data-analysis-module=/g) ?? []).length, 5);
    const cash = html.slice(
      html.indexOf('data-analysis-module="cash-flow"'),
      html.indexOf('data-analysis-module="financial-health"'),
    );
    for (const key of [
      'stockRepurchases',
      'dilutedShares',
      'dilutedSharesGrowth',
      'dividendsPaid',
      'dividendsPerShare',
      'dpsGrowth',
    ])
      assert.ok(!cash.includes(`data-metric="${key}"`));
    const shareholder = html.slice(
      html.indexOf('data-analysis-module="shareholder-returns"'),
    );
    for (const key of [
      'stockRepurchases',
      'dilutedShares',
      'dilutedSharesGrowth',
      'dividendsPaid',
      'dividendsPerShare',
      'dpsGrowth',
    ])
      assert.equal(
        (shareholder.match(new RegExp(`data-metric="${key}"`, 'g')) ?? [])
          .length,
        1,
      );
    assert.ok(shareholder.includes('Stock Repurchases Trend'));
    assert.ok(shareholder.includes('Diluted Shares Trend'));
    assert.ok(shareholder.includes('Dividends Per Share Trend'));
    assert.ok(cash.includes('data-metric="operatingCashFlow"'));
  }
});
