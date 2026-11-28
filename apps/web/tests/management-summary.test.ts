import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiResearchSummary } from '@company-research/shared';
import { ManagementSummary } from '../src/pages/CompanyDetail/Management/components/ManagementSummary.js';
const titles = [
  '经营表现与变化原因',
  '资金使用与重大决策',
  '未来经营重点与趋势',
  '重大风险',
];
const finding = {
  kind: '公司披露的事实' as const,
  text: '需求变化推动经营表现。',
  evidence: [
    {
      paragraphId: 'Item 7:p1',
      quote: 'Demand supported operating performance.',
    },
  ],
};
function render(groups: AiResearchSummary['summaryJson']['groups']) {
  return renderToStaticMarkup(
    createElement(ManagementSummary, { summary: { groups } }),
  );
}
test('legacy five-section cache retains all prose with hidden evidence in four directions without mutation', () => {
  const groups = [
    '经营表现及原因',
    '资本开支',
    '现金流与融资',
    '未来经营重点',
    '主要风险',
  ].map((topic, i) => ({
    topic,
    findings: [{ ...finding, text: `保留旧摘要内容${i}。` }],
  }));
  const before = structuredClone(groups);
  const html = render(groups);
  assert.equal((html.match(/<section/g) || []).length, 4);
  for (const title of titles) assert.ok(html.includes(title));
  for (let i = 0; i < 5; i++) assert.ok(html.includes(`保留旧摘要内容${i}。`));
  assert.ok(
    html.indexOf('保留旧摘要内容1。') < html.indexOf('保留旧摘要内容2。'),
  );
  assert.doesNotMatch(
    html,
    /Item 7:p1|Demand supported operating performance|原文依据/,
  );
  assert.ok(!html.includes('公司披露的事实'));
  assert.deepEqual(groups, before);
});
for (const company of ['Google', 'Apple', 'Nvidia'])
  test(`${company}: four-section layout supports sparse disclosures and distinguishes future views`, () => {
    const html = render(
      titles.map((topic, i) => ({
        topic,
        findings:
          i === 1
            ? []
            : [
                {
                  ...finding,
                  text: `${company}：公司预计继续投入。`,
                  kind: '管理层观点' as const,
                },
              ],
      })),
    );
    for (const title of titles) assert.ok(html.includes(title));
    assert.equal((html.match(/<section/g) || []).length, 4);
    assert.ok(html.includes('管理层观点'));
    assert.ok(html.includes('未找到充分的相关披露'));
    assert.ok(!html.includes('旧摘要'));
    assert.ok(!html.includes('AI 推断'));
  });
test('composed Item caches show their individual filing sources, structured risk impact and missing/legacy status', () => {
  const summary: AiResearchSummary['summaryJson'] = {
    groups: titles.map((topic, i) => ({
      topic,
      findings:
        i === 3
          ? [
              {
                ...finding,
                riskType: '竞争风险',
                text: '竞争影响需求。',
                impact: '可能降低经营收入。',
                evidence: [
                  {
                    paragraphId: 'Item 1A:p1',
                    quote: 'Competition may reduce revenue.',
                  },
                ],
              },
            ]
          : [],
    })),
    itemSources: [
      {
        item: 'Item 7',
        accessionNumber: 'old',
        sourceUrl: 'https://www.sec.gov/old',
        fiscalYear: 2024,
        filingDate: '2025-02-01',
        generatedAt: '2025-02-02',
        promptVersion: 'old',
        legacy: true,
      },
      {
        item: 'Item 1A',
        accessionNumber: 'new',
        sourceUrl: 'https://www.sec.gov/new',
        fiscalYear: 2025,
        filingDate: '2026-02-01',
        generatedAt: '2026-02-02',
        promptVersion: 'item1a-risks-v1',
        legacy: false,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(ManagementSummary, { summary }),
  );
  for (const value of [
    '竞争风险',
    '可能降低经营收入',
    '旧版混合摘要缓存',
    'https://www.sec.gov/old',
    'https://www.sec.gov/new',
  ])
    assert.ok(html.includes(value));
  const partial = renderToStaticMarkup(
    createElement(ManagementSummary, {
      summary: {
        groups: titles.map((topic) => ({ topic, findings: [] })),
        unavailableItems: ['Item 1A'],
      },
    }),
  );
  assert.ok(partial.includes('该章节尚无有效缓存'));
  assert.ok(!partial.includes('AI 推断'));
});
