import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FINANCIAL_METRICS,
  type FinancialPeriod,
} from '@company-research/shared';
import {
  CashFlowQualityChart,
  cashFlowQualitySeries,
} from '../src/pages/CompanyDetail/EnterpriseQuality/CashFlow/components/CashFlowQualityChart.js';
import { FinancialHealthChart } from '../src/pages/CompanyDetail/EnterpriseQuality/FinancialHealth/components/FinancialHealthChart.js';
import { cashFlowSeries } from '../src/pages/CompanyDetail/EnterpriseQuality/CashFlow/components/CashFlowCharts.js';
import { FinancialTrendChart } from '../src/pages/CompanyDetail/components/financial/FinancialTrendChart.js';
import { FinancialAnalysis } from '../src/pages/CompanyDetail/EnterpriseQuality/components/FinancialAnalysis.js';
import {
  formatAnalysisValue,
  analysisValue,
  METRICS,
} from '../src/pages/CompanyDetail/utils/financial-analysis.js';
const period = (
  year: number,
  values: Partial<FinancialPeriod> = {},
): FinancialPeriod =>
  ({
    ...Object.fromEntries(FINANCIAL_METRICS.map((k) => [k, null])),
    fiscalYear: year,
    fiscalQuarter: null,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    currency: 'USD',
    ...values,
  }) as FinancialPeriod;
const render = renderToStaticMarkup;
test('quality chart selects all or either percentage without changing cash flow colors or selection', () => {
  const series = cashFlowQualitySeries('all');
  assert.deepEqual(
    series.map((s) => s.key),
    ['fcfMargin', 'cashConversionRatio'],
  );
  assert.deepEqual(cashFlowQualitySeries('fcfMargin'), [series[0]]);
  assert.deepEqual(cashFlowQualitySeries('cashConversionRatio'), [series[1]]);
  assert.deepEqual(
    cashFlowSeries('all').map((s) => [s.key, s.color]),
    [
      ['operatingCashFlow', '#1677ff'],
      ['capex', '#d89614'],
      ['fcf', '#389e6f'],
    ],
  );
  assert.deepEqual(
    cashFlowSeries('capex').map((s) => s.key),
    ['capex'],
  );
  assert.equal(METRICS.cashConversionRatio.unit, 'percent');
  assert.match(METRICS.cashConversionRatio.description, /净利润须大于零/);
  assert.match(METRICS.fcfMargin.description, /收入须大于零/);
});
test('quality percentages preserve negatives, values over 100%, isolated points and null gaps across ten coordinates', () => {
  const rows = Array.from({ length: 10 }, (_, i) => period(2016 + i));
  Object.assign(rows[0], { fcfMargin: -20, cashConversionRatio: -150 });
  Object.assign(rows[9], { fcfMargin: 40, cashConversionRatio: 250 });
  const html = render(
    createElement(CashFlowQualityChart, { rows, mode: 'annual' }),
  );
  assert.equal((html.match(/data-period-end=/g) ?? []).length, 10);
  assert.equal((html.match(/<circle/g) ?? []).length, 4);
  assert.equal((html.match(/stroke="#389e6f"/g) ?? []).length, 0);
  assert.equal((html.match(/stroke="#1677ff"/g) ?? []).length, 0);
  assert.match(html, /FCF Margin: -20.00%/);
  assert.match(html, /Cash Conversion Ratio: 250.00%/);
  const single = render(
    createElement(FinancialTrendChart, {
      rows,
      mode: 'annual',
      series: cashFlowQualitySeries('cashConversionRatio'),
      unit: 'percent',
      title: 'Quality',
      retainEmptyPeriods: true,
    }),
  );
  assert.equal((single.match(/<circle/g) ?? []).length, 2);
  assert.doesNotMatch(single, /FCF Margin/);
  const empty = render(
    createElement(CashFlowQualityChart, {
      rows: rows.map((r) => ({
        ...r,
        fcfMargin: null,
        cashConversionRatio: null,
      })),
      mode: 'annual',
    }),
  );
  assert.equal((empty.match(/data-period-end=/g) ?? []).length, 10);
  assert.doesNotMatch(empty, /<circle|NaN|Infinity/);
});
test('cards read backend percentages only and never fill the latest null from an older quarter or annual value', () => {
  const annual = [
    period(2025, {
      operatingCashFlow: 200,
      fcf: 100,
      revenue: 100,
      netIncome: 100,
      fcfMargin: 100,
      cashConversionRatio: 200,
    }),
  ];
  const quarterly = [
    period(2026, {
      fiscalQuarter: 2,
      periodStart: '2026-04-01',
      periodEnd: '2026-06-30',
      fcfMargin: null,
      cashConversionRatio: null,
    }),
    period(2026, {
      fiscalQuarter: 1,
      periodEnd: '2026-03-31',
      fcfMargin: 40,
      cashConversionRatio: 250,
    }),
  ];
  assert.equal(
    analysisValue(quarterly[0], 'cashConversionRatio', 'quarterly'),
    null,
  );
  const html = render(
    createElement(FinancialAnalysis, {
      detail: { annual, quarterly },
      mode: 'quarterly',
      modules: ['cash-flow'],
    }),
  );
  const cards = html.slice(0, html.indexOf('Cash Flow Trends'));
  assert.doesNotMatch(cards, /250.00%|100.00%|200.00%/);
  assert.match(cards, /data-metric="cashConversionRatio"/);
  assert.match(html, /2026-04-01 至 2026-06-30/);
  assert.doesNotMatch(html, /<table|计算依据|TTM/);
  const legacy = period(2025, { operatingCashFlow: 100, netIncome: 25 });
  assert.equal(
    analysisValue(legacy, 'cashConversionRatio', 'annual'),
    null,
    'old API payload has no client-side ratio fallback',
  );
});

test('four real cached company responses render ten annual/quarterly periods, exact API percentages and unchanged financial health', () => {
  const dataset = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL('../../tests/fixtures/cash-flow-api.json.gz', import.meta.url),
      ),
    ).toString(),
  ) as {
    companies: Record<
      string,
      { annual: FinancialPeriod[]; quarterly: FinancialPeriod[] }
    >;
  };
  for (const [ticker, detail] of Object.entries(dataset.companies))
    for (const mode of ['annual', 'quarterly'] as const) {
      const before = structuredClone(detail),
        rows = detail[mode];
      assert.equal(rows.length, 10);
      const html = render(
        createElement(FinancialAnalysis, {
          detail,
          mode,
          modules: ['cash-flow', 'financial-health'],
        }),
      );
      const split = html.indexOf('data-analysis-module="financial-health"');
      const cash = html.slice(0, split),
        health = html.slice(split);
      assert.equal((cash.match(/data-metric=/g) ?? []).length, 5);
      assert.equal((health.match(/data-metric=/g) ?? []).length, 6);
      assert.equal((cash.match(/data-period-end=/g) ?? []).length, 20);
      assert.equal((cash.match(/role="radiogroup"/g) ?? []).length, 2);
      const latest = rows[0];
      for (const key of ['fcfMargin', 'cashConversionRatio'] as const) {
        assert.ok(
          cash.includes(formatAnalysisValue(latest[key] ?? null, 'percent')),
          `${ticker} ${mode} ${key}`,
        );
        assert.match(cash, new RegExp(`data-metric="${key}"`));
      }
      const independent = render(
        createElement(FinancialHealthChart, { rows, mode }),
      );
      assert.deepEqual(
        health
          .slice(0, health.indexOf('Financial Ratio Trends'))
          .match(/<circle[^>]*>.*?<\/circle>/g),
        independent.match(/<circle[^>]*>.*?<\/circle>/g),
        'health data points, coordinates, units and hover values must remain identical',
      );
      for (const key of [
        'cashAndShortTermSecurities',
        'totalDebt',
        'currentRatio',
        'debtToEquity',
      ] as const)
        assert.ok(
          health.includes(
            formatAnalysisValue(
              analysisValue(latest, key, mode),
              METRICS[key].unit,
            ),
          ),
        );
      assert.doesNotMatch(html, /<table|计算依据|缺失原因列表|TTM/);
      assert.deepEqual(detail, before);
      if (ticker === 'GOOGL' && mode === 'quarterly')
        assert.match(cash, /-7.11%/);
    }
});
