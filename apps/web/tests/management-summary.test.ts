import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiResearchSummary } from '@company-research/shared';
import { ManagementSummary } from '../src/ManagementSummary.js';
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
test('legacy five-section cache retains all prose and citations in four directions without mutation', () => {
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
  assert.ok(
    html.includes('Item 7:p1: Demand supported operating performance.'),
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
