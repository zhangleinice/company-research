import {
  CapitalNotes,
  considerationExplanation,
} from '../src/analysis/CapitalAllocationResearch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FINANCIAL_METRICS,
  type FinancialPeriod,
  type AnnualCapitalAllocation,
} from '@company-research/shared';
import {
  ManagementAnalysis,
  managementPeriods,
} from '../src/analysis/ManagementAnalysis.js';
import { fetchCompanyDetail } from '../src/api.js';
function period(year: number): FinancialPeriod {
  return {
    ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, null])),
    fiscalYear: year,
    fiscalQuarter: null,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    currency: 'USD',
    dividendsPerShare: 0.83,
    dpsGrowth: 5,
    stockRepurchases: 80e6,
    dilutedShares: 100e6,
    dilutedSharesGrowth: -2,
  } as FinancialPeriod;
}
const unknown = { value: null, reason: '口径未核准', sources: [] };
function metadata(): AnnualCapitalAllocation {
  return {
    references: {},
    dividendsPaid: { ...unknown, value: 20e6, reason: null, scope: 'total' },
    sharesOutstanding: { ...unknown, value: 90e6, reason: null },
    payoutRatio: unknown,
    buybackToFcf: { ...unknown, value: 160, reason: null },
  };
}
test('renders the overview before five ordered sections with thirteen metrics and three charts', () => {
  const row = period(2025);
  row.capitalAllocation = metadata();
  row.capitalAllocation.debtCashFlows = {
    debtIssuance: { value: 20e6, reason: null, sources: [] },
    debtRepayments: { value: 0, reason: null, sources: [] },
  };
  const html = renderToStaticMarkup(
    createElement(ManagementAnalysis, { detail: { annual: [row] } }),
  );
  const positions = [
    'dividends',
    'repurchases',
    'reinvestment',
    'acquisitions',
    'financing',
  ].map((key) => html.indexOf(`data-analysis-module="${key}"`));
  assert.ok(positions.every((x) => x >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.equal((html.match(/data-metric=/g) ?? []).length, 13);
  assert.equal((html.match(/<svg/g) ?? []).length, 3); // existing historical charts; overview no longer has a selector
  assert.ok(
    html.indexOf('data-analysis-module="capital-allocation-overview"') <
      positions[0],
  );
  assert.ok(html.includes('160.00%'));
  const debtCards = html.slice(html.indexOf('data-metric="debtIssuance"'));
  assert.ok(debtCards.includes('百万美元'));
  assert.match(debtCards, /ant-statistic-content-value">20</);
  assert.match(debtCards, /ant-statistic-content-value">0</);

  assert.ok(html.includes('非普通股专属口径'));
  assert.ok(html.includes('口径未核准'));
  assert.ok(html.includes('债务发行现金流入'));
  assert.ok(html.includes('债务偿还现金流出'));
  assert.ok(html.includes('未来投资计划'));
  assert.ok(html.includes('重要融资条款'));
  assert.ok(html.includes('Business Investment · 业务投资'));
  assert.ok(!html.includes('Reinvestment · 业务再投资'));
  assert.ok(!html.includes('Quarterly'));
});
test('keeps ten complete annual periods independent of unrelated quarterly selection', () => {
  const annual = Array.from({ length: 12 }, (_, i) => period(2014 + i));
  const partial = { ...period(2026), periodEnd: '2026-06-30' };
  const quarter = {
    ...period(2026),
    fiscalQuarter: 3,
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
  };
  const rows = managementPeriods({ annual: [partial, quarter, ...annual] });
  assert.equal(rows.length, 10);
  assert.equal(rows[0].fiscalYear, 2025);
  assert.equal(rows[9].fiscalYear, 2016);
  const before = renderToStaticMarkup(
    createElement(ManagementAnalysis, { detail: { annual } }),
  );
  const after = renderToStaticMarkup(
    createElement(ManagementAnalysis, { detail: { annual: [...annual] } }),
  );
  assert.equal(before, after);
});
test('empty/legacy caches keep unknown values and do not fabricate zero ratios or ending shares', () => {
  for (const annual of [[], [period(2025)]]) {
    const html = renderToStaticMarkup(
      createElement(ManagementAnalysis, { detail: { annual } }),
    );
    assert.ok(
      html.includes(
        annual.length ? '接口未返回资本配置来源' : '暂无完整年度财务数据',
      ),
    );
    assert.ok(!html.includes('缺少已核准的财年末普通股总量'));
    assert.ok(!html.includes('>0%</'));
  }
});

test('preserves allocation metadata through API decoding and displays cached GOOGL FY2025 values', async () => {
  // Offline snapshot of the audited API values; no SEC or company-specific production rule.
  const row = period(2025);
  row.sharesOutstanding = 12088000000;
  row.stockRepurchases = 45709000000;
  row.fcf = 73266000000;
  row.capitalAllocation = metadata();
  row.capitalAllocation.sharesOutstanding = {
    value: row.sharesOutstanding,
    reason: null,
    sources: [],
  };
  row.capitalAllocation.buybackToFcf = {
    value: (row.stockRepurchases / row.fcf) * 100,
    reason: null,
    sources: [],
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ ticker: 'GOOGL', annual: [row], quarterly: [] }),
    );
  try {
    const decoded = await fetchCompanyDetail('GOOGL');
    assert.deepEqual(
      decoded.annual[0].capitalAllocation,
      row.capitalAllocation,
    );
    const html = renderToStaticMarkup(
      createElement(ManagementAnalysis, { detail: decoded }),
    );
    const shares = html
      .split('data-metric="sharesOutstanding"')[1]
      .split('data-metric="buybackToFcf"')[0];
    const buyback = html.split('data-metric="buybackToFcf"')[1];
    assert.ok(shares.includes('12,088'));
    assert.ok(buyback.includes('62.39%'));
    assert.ok(!html.includes('接口未返回资本配置来源'));
  } finally {
    globalThis.fetch = original;
  }
});

test('renders unified capital information with dated pending acquisitions, explicit credit facilities and safe missing states', () => {
  const sourceUrl =
    'https://www.sec.gov/Archives/edgar/data/1652044/example.htm';
  const source = {
    filingId: 'cached-filing',
    cik: '0001652044',
    accessionNumber: '0001652044-26-000018',
    filingType: '10-K',
    fiscalYear: 2025,
    reportDate: '2025-12-31',
    filingDate: '2026-02-05',
    sourceUrl,
    item: 'Item 7' as const,
    parserVersion: 'items-v2',
    inputHash: 'a'.repeat(64),
    evidenceParagraphs: [],
  };
  const evidence = [
    {
      paragraphId: 'Item 7:p1',
      quote: 'We expect to increase investment in technical infrastructure.',
    },
  ];
  const info: import('@company-research/shared').CapitalAllocationInformation =
    {
      version: 1,
      coverage: 'complete',
      coverageReason: null,
      source,
      reinvestment: {
        investmentAreas: [],
        investmentPurposes: [],
        investmentPlans: [
          { text: '预计增加基础设施投资', kind: 'plan', evidence },
        ],
        investmentRisks: [],
      },
      acquisitions: {
        events: ['Wiz', 'Intersect'].map((targetName, i) => ({
          targetName,
          transactionDate: {
            value: i ? '2025-12' : '2025-03',
            precision: 'month',
            type: 'agreement',
            evidence,
          },
          transactionValue: {
            rawText: i ? '$4.8 billion' : '$32.0 billion',
            currency: 'USD',
            scope: i ? 'cashPlusDebt' : 'cash',
            evidence,
          },
          acquisitionPurpose: null,
          transactionStatus: 'pending',
          considerationType: i ? 'cashPlusDebt' : 'cash',
          evidence,
        })),
      },
      debtAndFinancing: {
        financingActivities: [
          {
            text: '尚未使用的循环授信额度',
            kind: 'fact',
            activityType: 'creditFacility',
            evidence,
          },
        ],
        financingPurposes: [],
        financingTerms: [],
        financingRisks: [],
      },
    };
  const research: import('../src/AiResearch.js').CachedResearch = {
    error: '',
    state: {
      status: 'READY',
      error: null,
      summary: {
        fiscalYear: 2025,
        filingDate: '2026-02-05',
        accessionNumber: source.accessionNumber,
        section: 'management',
        model: 'mock',
        promptVersion: 'management-insights-v4',
        sourceUrl,
        createdAt: '2026-11-23',
        updatedAt: '2026-11-23',
        summaryJson: { groups: [], capitalAllocation: info },
      },
    },
  };
  const render = () =>
    renderToStaticMarkup(
      createElement(ManagementAnalysis, {
        detail: { annual: [period(2025)] },
        research,
      }),
    );
  const wiz = info.acquisitions.events[0];
  wiz.transactionValue!.evidence = [
    {
      paragraphId: 'Item 7:p1',
      quote:
        'We agreed to acquire the target for $32.0 billion, subject to closing adjustments, in an all-cash transaction.',
    },
  ];
  assert.match(considerationExplanation(wiz), /最终金额可能因交割调整/);
  assert.doesNotMatch(considerationExplanation(wiz), /其他|部分|完整交易/);
  assert.match(
    considerationExplanation(info.acquisitions.events[1]),
    /现金金额不等于完整交易对价/,
  );
  assert.match(
    considerationExplanation({ ...wiz, transactionValue: null }),
    /金额未明确/,
  );
  assert.match(
    considerationExplanation({ ...wiz, considerationType: 'unknown' }),
    /未明确/,
  );
  info.reinvestment.investmentAreas = Array.from({ length: 6 }, (_, i) => ({
    text: `完整投资信息${i}：${i + 1}亿美元`,
    kind: i === 5 ? 'plan' : 'fact',
    evidence,
  }));
  const noteProps = {
    research,
    groups: [
      {
        key: 'investmentAreas',
        title: '主要投资方向与项目',
        notes: info.reinvestment.investmentAreas,
      },
    ],
  };
  const collapsed = renderToStaticMarkup(
    createElement(CapitalNotes, noteProps),
  );
  assert.ok(collapsed.includes('完整投资信息2'));
  assert.ok(!collapsed.includes('完整投资信息3'));
  assert.ok(collapsed.includes('展开其余投资信息（3条）'));
  const expanded = renderToStaticMarkup(
    createElement(CapitalNotes, { ...noteProps, investmentDetailsOpen: true }),
  );
  for (const note of info.reinvestment.investmentAreas)
    assert.ok(expanded.includes(note.text));
  assert.ok(expanded.includes('管理层计划／预期'));
  const html = render();
  assert.ok(html.includes('现金对价'));
  assert.ok(!html.includes('仅现金部分，不代表交易总成本'));
  assert.ok(html.includes('另行承担债务，现金金额不等于完整交易对价'));
  assert.ok(html.includes('2025-12-31'));
  assert.ok(html.includes('2026-02-05'));
  assert.ok(html.includes(sourceUrl));
  assert.doesNotMatch(html, /原文依据|ant-table-row-expand-icon/);
  assert.ok(html.includes('Wiz'));
  assert.ok(html.includes('Intersect'));
  assert.equal((html.match(/>待完成</g) ?? []).length, 2);
  assert.ok(html.includes('2025-03'));
  assert.ok(!html.includes('2025-03-01'));
  assert.ok(html.includes('— 未明确披露'));
  assert.ok(html.includes('不是实时状态'));
  assert.ok(html.includes('管理层计划／预期'));
  assert.ok(html.includes('授信额度'));
  assert.ok(html.includes('债务发行现金流入'));
  assert.ok(html.includes('债务偿还现金流出'));
  assert.ok(html.includes('data-metric="debtIssuance"'));
  info.acquisitions.events = [];
  assert.ok(render().includes('未提取到收购事件，不代表公司没有收购'));
  info.coverage = 'partial';
  info.coverageReason = '输入表格无法完整还原';
  assert.ok(render().includes('输入覆盖不足'));
  research.state!.status = 'FAILED';
  assert.ok(render().includes('继续展示上一次成功结果'));
  assert.ok(render().includes('预计增加基础设施投资'));
  info.source!.accessionNumber = 'different-filing';
  assert.ok(!render().includes('预计增加基础设施投资'));
});
