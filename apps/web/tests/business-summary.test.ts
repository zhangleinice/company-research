import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BusinessSummary } from '../src/BusinessSummary.js';
import type { AiResearchSummary } from '@company-research/shared';
const finding = {
  kind: '公司披露的事实' as const,
  text: '面向企业提供软件订阅服务。',
  evidence: [
    { paragraphId: 'Item 1:p1', quote: 'Customers subscribe to services.' },
  ],
};
test('legacy cache is presented as four sections without risk duplication or invented business fields', () => {
  const groups = [
    '公司主要业务',
    '主要业务板块',
    '竞争优势',
    '增长机会',
    '业务依赖与风险',
  ].map((topic) => ({
    topic,
    findings: [
      {
        ...finding,
        text: topic === '业务依赖与风险' ? '风险专属内容' : finding.text,
      },
    ],
  }));
  const html = renderToStaticMarkup(
    createElement(BusinessSummary, { summary: { groups } }),
  );
  for (const title of [
    '公司做什么？',
    '公司怎么赚钱？',
    '公司有什么竞争优势？',
    '未来有哪些增长机会？',
  ])
    assert.ok(html.includes(title));
  assert.equal((html.match(/<section/g) || []).length, 4);
  assert.ok(!html.includes('风险专属内容'));
  assert.ok(!html.includes('业务依赖与风险'));
  assert.ok(html.includes('旧版缓存'));
  assert.ok(html.includes('Item 1'));
  assert.ok(!html.includes('公司披露的事实'));
});
test('new commercial model renders actual dynamic businesses, citations and only necessary classification badges', () => {
  const groups = [
    '公司做什么？',
    '公司怎么赚钱？',
    '公司有什么竞争优势？',
    '未来有哪些增长机会？',
  ].map((topic) => ({
    topic,
    findings:
      [] as AiResearchSummary['summaryJson']['groups'][number]['findings'],
  }));
  groups[1].findings = Array.from({ length: 6 }, (_, i) => ({
    ...finding,
    businessName: `Official Division ${i}`,
    offering: '企业软件。',
    monetization: '订阅收费。',
  }));
  groups[2].findings = [
    { ...finding, kind: '管理层观点', text: '公司认为其服务效率具有优势。' },
    { ...finding, kind: 'AI 推断', text: '根据服务规模，可能存在成本优势。' },
  ];
  const html = renderToStaticMarkup(
    createElement(BusinessSummary, { summary: { groups } }),
  );
  assert.equal((html.match(/Official Division/g) || []).length, 6);
  assert.ok(html.includes('做什么：'));
  assert.ok(html.includes('怎么赚钱：'));
  assert.ok(html.includes('公司主张'));
  assert.ok(html.includes('分析判断'));
  assert.ok(!html.includes('Google Services'));
  assert.ok(!html.includes('旧版缓存'));
});
