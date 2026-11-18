import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { companyWebsite } from '@company-research/shared';
import { InvestorRelationsLink } from '../src/InvestorRelationsLink.js';
test('official SEC-provided absolute HTTP(S) links open in a new tab with opener/referrer protection', () => {
  const html = renderToStaticMarkup(
    createElement(InvestorRelationsLink, {
      url: 'https://ir.example.com/earnings',
    }),
  );
  assert.ok(html.includes('投资者关系 ↗'));
  assert.ok(html.includes('href="https://ir.example.com/earnings"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.equal(
    companyWebsite(' http://example.com/ir '),
    'http://example.com/ir',
  );
});
test('missing and unsafe URLs hide the link completely without an error or placeholder', () => {
  for (const url of [
    null,
    '',
    'javascript:alert(1)',
    'data:text/html,hi',
    'mailto:ir@example.com',
    '//example.com/ir',
    '/investors',
    'example.com',
    'https://user:pass@example.com',
    'https://exa\nmple.com',
  ]) {
    assert.equal(companyWebsite(url), null);
    assert.equal(
      renderToStaticMarkup(createElement(InvestorRelationsLink, { url })),
      '',
    );
  }
});
