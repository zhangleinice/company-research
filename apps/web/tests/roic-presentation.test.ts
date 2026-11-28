import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FINANCIAL_METRICS,
  type EnterpriseQuality,
  type FinancialPeriod,
  type FinancialMode,
  type AnnualRoicHistory,
  type QuarterlyRoicHistory,
  type RoicIssue,
} from '@company-research/shared';
import { FinancialAnalysis } from '../src/pages/CompanyDetail/EnterpriseQuality/components/FinancialAnalysis.js';
import {
  capitalReturnSeries,
  CapitalReturnTrends,
  RoicMetricCard,
} from '../src/pages/CompanyDetail/EnterpriseQuality/Profitability/components/RoicPresentation.js';
import {
  matchRoic,
  roicHistory,
  roicPercent,
  roicStatus,
} from '../src/pages/CompanyDetail/EnterpriseQuality/Profitability/utils/roic-presentation.js';
import { fetchEnterpriseQuality } from '../src/services/api.js';
const samples = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL('../../tests/fixtures/roic-api-history.json.gz', import.meta.url),
    ),
  ).toString(),
) as Record<
  string,
  { annualRoic: AnnualRoicHistory; quarterlyRoic: QuarterlyRoicHistory }
>;
const empty = { value: null, start: null, end: '', concept: null, items: [] };
function data(ticker = 'AAPL'): EnterpriseQuality {
  return {
    version: 1,
    ticker,
    cik: null,
    start: null,
    asOf: null,
    applicable: true,
    netIncome: empty,
    commonNetIncome: empty,
    depreciationAmortization: empty,
    depreciation: empty,
    amortization: empty,
    ebit: empty,
    capex: empty,
    taxExpense: empty,
    pretaxIncome: empty,
    historicalTaxRate: null,
    capital: [],
    ...structuredClone(samples[ticker]),
  };
}
function rows(d: EnterpriseQuality, mode: FinancialMode): FinancialPeriod[] {
  return roicHistory(d, mode)!.results.map((r) => ({
    ...Object.fromEntries(FINANCIAL_METRICS.map((k) => [k, null])),
    fiscalYear: r.fiscalYear,
    fiscalQuarter: 'fiscalQuarter' in r ? r.fiscalQuarter : null,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    currency: r.currency,
    roe: 25,
    grossMargin: 40,
    operatingMargin: 30,
    netMargin: 20,
  })) as FinancialPeriod[];
}
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);
const circles = (html: string, color = '#389e6f') =>
  (html.match(new RegExp(`<circle[^>]*fill="${color}"`, 'g')) ?? []).length;
const lines = (html: string, color = '#389e6f') =>
  (html.match(new RegExp(`<line[^>]*stroke="${color}"`, 'g')) ?? []).length;
const card = (
  d: EnterpriseQuality,
  mode: FinancialMode,
  row = rows(d, mode)[0],
) =>
  render(
    createElement(RoicMetricCard, {
      row,
      mode,
      resource: { data: d, loading: false, error: '' },
    }),
  );
afterEach(() => mock.restoreAll());

test('four real SEC API samples render exact annual/quarterly periods, original four metrics and five-card order', () => {
  for (const ticker of ['GOOGL', 'AAPL', 'MSFT', 'KO'])
    for (const mode of ['annual', 'quarterly'] as const) {
      const d = data(ticker),
        periods = rows(d, mode);
      const html = render(
        createElement(FinancialAnalysis, {
          detail: {
            annual: rows(d, 'annual'),
            quarterly: rows(d, 'quarterly'),
          },
          mode,
          modules: ['profitability'],
          quality: { data: d, error: '', loading: false },
        }),
      );
      assert.match(
        html,
        /Profitability &amp; Capital Returns · 盈利与资本回报/,
      );
      for (const k of [
        'grossMargin',
        'operatingMargin',
        'netMargin',
        'roe',
        'roic',
      ])
        assert.ok(html.includes(`data-metric="${k}"`));
      assert.ok(
        html.indexOf('data-metric="roic"') > html.indexOf('data-metric="roe"'),
      );
      assert.match(html, /Profit Margin Trends/);
      assert.match(html, /Capital Return Trends/);
      assert.equal((html.match(/data-period-end=/g) ?? []).length, 10);
      for (const row of periods) assert.ok(html.includes(row.periodEnd));
      assert.match(html, /40.00%/);
      assert.match(html, /30.00%/);
      assert.match(html, /20.00%/);
      const value = roicPercent(
        matchRoic(periods[0], roicHistory(d, mode), mode),
      );
      assert.ok(
        card(d, mode).includes(
          value === null
            ? '—'
            : `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
        ),
      );
      if (mode === 'quarterly') assert.match(html, /非年化、非 TTM/);
    }
});
test('approved annual and independent-quarter API ratios are only formatted, with no annualization or clipping', () => {
  assert.match(card(data('GOOGL'), 'annual'), /36.73%/);
  assert.match(card(data('AAPL'), 'annual'), /102.56%/);
  assert.match(card(data('MSFT'), 'quarterly'), /7.43%/);
  assert.doesNotMatch(card(data('MSFT'), 'quarterly'), /29.73%/);
  const d = data();
  d.annualRoic!.results[0].roic = -0.123;
  assert.match(card(d, 'annual'), /-12.30%/);
  d.annualRoic!.results[0].roic = 0;
  assert.match(card(d, 'annual'), /0.00%/);
});
test('single points and all-missing ROIC preserve ROE and all ten time coordinates', () => {
  for (const [ticker, mode, count] of [
    ['GOOGL', 'annual', 1],
    ['MSFT', 'quarterly', 1],
    ['KO', 'annual', 0],
    ['KO', 'quarterly', 0],
  ] as const) {
    const d = data(ticker);
    const html = render(
      createElement(CapitalReturnTrends, {
        rows: rows(d, mode),
        mode,
        data: d,
      }),
    );
    assert.equal(circles(html), count);
    assert.equal(lines(html), 0);
    assert.equal(circles(html, '#1677ff'), mode === 'annual' ? 10 : 0);
    assert.equal((html.match(/data-period-end=/g) ?? []).length, 10);
    assert.ok(html.includes('<svg'));
    if (ticker === 'KO' && mode === 'quarterly')
      assert.match(html, /暂无可靠数据，保留完整报告期间/);
  }
});
test('missing middle periods break lines without compressing the timeline or moving isolated points to the oldest date', () => {
  const d = data();
  const result = d.annualRoic!.results;
  result[1].roic = null;
  result[1].status = 'MISSING_DATA';
  const html = render(
    createElement(CapitalReturnTrends, {
      rows: rows(d, 'annual'),
      mode: 'annual',
      data: d,
    }),
  );
  assert.equal(circles(html), 2);
  assert.equal(lines(html), 0);
  assert.equal((html.match(/data-period-end=/g) ?? []).length, 10);
  const x = [...html.matchAll(/<circle cx="([\d.]+)"[^>]*fill="#389e6f"/g)].map(
    (x) => Number(x[1]),
  );
  assert.equal(x.length, 2);
  assert.ok(x.every((v) => v > 400));
  const full = data();
  assert.equal(
    lines(
      render(
        createElement(CapitalReturnTrends, {
          rows: rows(full, 'annual'),
          mode: 'annual',
          data: full,
        }),
      ),
    ),
    2,
  );
});
test('the latest missing or absent period never falls back to an earlier valid return', () => {
  const d = data();
  const current = rows(d, 'annual')[0];
  d.annualRoic!.results[0].roic = null;
  d.annualRoic!.results[0].status = 'MISSING_DATA';
  d.annualRoic!.results[0].missingReasons = [
    {
      code: 'ANNUAL_INCOME_MISSING',
      field: 'tax',
      message: '本期所得税费用缺失',
    },
  ];
  assert.match(card(d, 'annual'), /本期所得税费用缺失/);
  assert.doesNotMatch(card(d, 'annual'), /102.90%|102.56%/);
  d.annualRoic!.results.shift();
  const html = card(d, 'annual', current);
  assert.match(html, /未使用更早期间替代/);
  assert.doesNotMatch(html, /102.90%/);
});
test('mode and actual duration matching prevent Q4 and annual statements with the same end date from being mixed', () => {
  const d = data();
  const a = rows(d, 'annual')[0],
    q = rows(d, 'quarterly')[0];
  assert.equal(a.periodEnd, q.periodEnd);
  assert.equal(matchRoic(a, d.quarterlyRoic, 'annual'), undefined);
  assert.equal(matchRoic(q, d.annualRoic, 'quarterly'), undefined);
  const modified = { ...q, periodStart: '2026-01-01' };
  assert.equal(matchRoic(modified, d.quarterlyRoic, 'quarterly'), undefined);
  const duplicate = structuredClone(d.annualRoic!);
  duplicate.results.push(duplicate.results[0]);
  assert.equal(matchRoic(a, duplicate, 'annual'), undefined);
  assert.match(card(d, 'annual'), /102.56%/);
  assert.match(card(d, 'quarterly'), /未核准/);
});
test('old caches, missing inputs, unapproved capital and inapplicable/invalid results have distinct visible states', () => {
  const d = data();
  delete d.annualRoic;
  assert.match(card(d, 'annual', rows(data(), 'annual')[0]), /旧数据尚未刷新/);
  const reason = (code: string, message: string): RoicIssue => ({
    code,
    message,
    field: 'test',
  });
  for (const [status, reasons, label] of [
    [
      'MISSING_DATA',
      [reason('ANNUAL_INCOME_MISSING', '税前利润缺失')],
      '输入缺失',
    ],
    [
      'MISSING_DATA',
      [reason('FINANCING_DEBT_SCOPE', '融资租赁债务尚未核准')],
      '未核准',
    ],
    [
      'MISSING_DATA',
      [reason('ANNUAL_CACHE_VERSION', '旧年度输入没有当前版本')],
      '旧数据尚未刷新',
    ],
    [
      'NOT_APPLICABLE',
      [reason('FINANCIAL_SECTOR', '金融企业暂不适用')],
      '不适用',
    ],
    [
      'INVALID_INPUT',
      [reason('ABNORMAL_TAX_RATE', '有效税率超出范围')],
      '异常输入',
    ],
  ] as const) {
    const x = data();
    Object.assign(x.annualRoic!.results[0], {
      status,
      missingReasons: reasons,
      roic: null,
    });
    const html = card(x, 'annual');
    assert.match(html, new RegExp(label));
    assert.ok(html.includes(reasons[0].message));
  }
  const error = render(
    createElement(RoicMetricCard, {
      mode: 'annual',
      row: rows(data(), 'annual')[0],
      resource: { data: null, error: '缓存读取失败', loading: false },
    }),
  );
  assert.match(error, /缓存读取失败/);
  assert.doesNotMatch(error, /0.00%/);
  assert.equal(roicStatus(undefined, undefined), '旧数据尚未刷新');
});
test('the existing quality cache endpoint transports both histories with one GET and cancellation, without refresh/SEC/AI requests', async () => {
  const d = data('MSFT'),
    controller = new AbortController();
  const f = mock.method(
    globalThis,
    'fetch',
    async (url: string, init?: RequestInit) => {
      assert.equal(init?.signal, controller.signal);
      assert.equal(url, '/api/companies/MSFT/valuation/quality');
      assert.ok(init?.method === undefined || init.method === 'GET');
      return new Response(JSON.stringify(d));
    },
  );
  const actual = await fetchEnterpriseQuality('MSFT', controller.signal);
  assert.deepEqual(actual, d);
  assert.equal(f.mock.callCount(), 1);
});

test('capital trend tooltips preserve negative and over-100-percent returns rather than clamping the axis', () => {
  const d = data();
  d.annualRoic!.results[2].roic = -0.123;
  const html = render(
    createElement(CapitalReturnTrends, {
      rows: rows(d, 'annual'),
      mode: 'annual',
      data: d,
    }),
  );
  assert.match(html, /ROIC: -12.30%/);
  assert.match(html, /ROIC: 102.56%/);
  assert.equal(circles(html), 3);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('a present but empty ROIC history is missing input, distinct from an unversioned legacy response', () => {
  const h = structuredClone(data().annualRoic!);
  h.results = [];
  h.missingReasons = [
    {
      code: 'ANNUAL_CACHE_UNAVAILABLE',
      field: 'annualFinancials',
      message: '没有可用的完整年度财务缓存',
    },
  ];
  assert.equal(roicStatus(undefined, h), '输入缺失');
  assert.equal(roicStatus(undefined, undefined), '旧数据尚未刷新');
});

test('profitability keeps only five cards and both trends, with no ROIC history, source table or replacement details entry in either mode', () => {
  for (const ticker of ['GOOGL', 'AAPL', 'MSFT', 'KO']) {
    for (const mode of ['annual', 'quarterly'] as const) {
      const d = data(ticker),
        before = structuredClone(d);
      const html = render(
        createElement(FinancialAnalysis, {
          detail: {
            annual: rows(d, 'annual'),
            quarterly: rows(d, 'quarterly'),
          },
          mode,
          modules: ['profitability'],
          quality: { data: d, error: '', loading: false },
        }),
      );
      assert.equal((html.match(/data-metric=/g) ?? []).length, 5);
      assert.equal((html.match(/class="metric-help"/g) ?? []).length, 5);
      assert.match(html, /aria-label="ROIC 指标说明"/);
      assert.match(html, /Profit Margin Trends/);
      assert.match(html, /Capital Return Trends/);
      assert.equal((html.match(/data-period-end=/g) ?? []).length, 10);
      assert.doesNotMatch(
        html,
        /ROIC 历史数据|data-roic-history|<table|展开行|查看详情|ant-collapse|SEC 原始报告|计算政策版本/,
      );
      assert.deepEqual(
        d,
        before,
        'presentation removal must not mutate API inputs or provenance',
      );
    }
  }
});

test('capital returns can select ROE or ROIC alone while retaining their original colors', () => {
  const all = capitalReturnSeries('all');
  assert.deepEqual(
    all.map((x) => x.key),
    ['roe', 'roic'],
  );
  assert.deepEqual(capitalReturnSeries('roe'), [all[0]]);
  assert.deepEqual(capitalReturnSeries('roic'), [all[1]]);
  assert.deepEqual(
    all.map((x) => x.color),
    ['#1677ff', '#389e6f'],
  );
});
