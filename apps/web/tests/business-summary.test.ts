import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BusinessSummary } from '../src/BusinessSummary.js';
import {
  BUSINESS_MODEL_PROMPT_VERSION,
  type AiResearchSummary,
} from '@company-research/shared';
const finding = {
  kind: '公司披露的事实' as const,
  text: '面向企业提供软件订阅服务。',
  evidence: [
    { paragraphId: 'Item 1:p1', quote: 'Customers subscribe to services.' },
  ],
};
test('legacy cache renders three questions with a legacy marker, hiding competitive/risk sections without mutating its data', () => {
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
    '未来有哪些增长机会？',
  ])
    assert.ok(html.includes(title));
  assert.equal((html.match(/<section/g) || []).length, 3);
  assert.ok(!html.includes('公司有什么竞争优势？'));
  assert.ok(!html.includes('风险专属内容'));
  assert.ok(!html.includes('业务依赖与风险'));
  assert.ok(html.includes('旧版缓存'));
  assert.ok(html.includes('Item 1'));
  assert.ok(!html.includes('公司披露的事实'));
});
test('new commercial model renders actual dynamic businesses, citations and only necessary classification badges', () => {
  const groups = ['公司做什么？', '公司怎么赚钱？', '未来有哪些增长机会？'].map(
    (topic) => ({
      topic,
      findings:
        [] as AiResearchSummary['summaryJson']['groups'][number]['findings'],
    }),
  );
  groups[0].findings = [{ ...finding, businessName: 'Enterprise Platform' }];
  groups[1].findings = Array.from({ length: 6 }, (_, i) => ({
    ...finding,
    businessName: `Official Division ${i}`,
    offering: '企业软件。',
    monetization: '订阅收费。',
  }));
  groups[2].findings = [
    {
      ...finding,
      kind: '管理层观点',
      text: '公司计划扩展企业服务，商业化仍不确定。',
    },
  ];
  const html = renderToStaticMarkup(
    createElement(BusinessSummary, {
      summary: { groups },
      promptVersion: BUSINESS_MODEL_PROMPT_VERSION,
    }),
  );
  assert.equal((html.match(/Official Division/g) || []).length, 6);
  assert.ok(html.includes('Enterprise Platform'));
  assert.ok(html.includes('做什么：'));
  assert.ok(html.includes('怎么赚钱：'));
  assert.ok(html.includes('公司主张'));
  assert.ok(!html.includes('公司有什么竞争优势？'));
  assert.equal((html.match(/<section/g) || []).length, 3);
  assert.ok(!html.includes('Google Services'));
  assert.ok(!html.includes('旧版缓存'));
});

test('previous four-question business-model cache preserves supported content and citations while remaining explicitly legacy', () => {
  const groups = [
    '公司做什么？',
    '公司怎么赚钱？',
    '公司有什么竞争优势？',
    '未来有哪些增长机会？',
  ].map((topic) => ({
    topic,
    findings: [
      {
        ...finding,
        text:
          topic === '公司有什么竞争优势？' ? '隐藏的旧优势分析' : finding.text,
      },
    ],
  }));
  const before = JSON.stringify(groups);
  const html = renderToStaticMarkup(
    createElement(BusinessSummary, {
      summary: { groups },
      promptVersion: 'business-model-v3',
    }),
  );
  assert.ok(html.includes('旧版缓存'));
  assert.ok(!html.includes('隐藏的旧优势分析'));
  assert.equal((html.match(/<section/g) || []).length, 3);
  assert.ok(html.includes('Item 1'));
  assert.equal(JSON.stringify(groups), before);
});
