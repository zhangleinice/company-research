import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchRoutes, MemoryRouter } from 'react-router-dom';
import {
  companyPath,
  legacyHomePath,
  listFilters,
  listReturnPath,
  routePaths,
  valuationPath,
} from '../src/routes.js';
import { CompanyListPage } from '../src/CompanyListPage.js';
const routes = Object.values(routePaths).map((path) => ({ path }));
test('React Router matches independent company, favorite, merger, detail and valuation routes', () => {
  for (const [url, expected] of [
    ['/companies', routePaths.companies],
    ['/favorites', routePaths.favorites],
    ['/mergers', routePaths.mergers],
    ['/companies/BRK.B', routePaths.detail],
    ['/companies/GOOGL/valuation', routePaths.valuation],
  ])
    assert.equal(matchRoutes(routes, url)?.at(-1)?.route.path, expected);
  assert.equal(
    matchRoutes(routes, '/companies/GOOGL/valuation')?.at(-1)?.params.ticker,
    'GOOGL',
  );
  assert.equal(matchRoutes(routes, '/unknown'), null);
});
test('detail and valuation links retain favorite filters across return, direct load and refresh', () => {
  const from = '/favorites?page=2&q=Alphabet&mode=quarterly';
  for (const path of [companyPath('GOOG', from), valuationPath('GOOG', from)]) {
    const u = new URL(path, 'http://localhost');
    assert.equal(listReturnPath(u.searchParams.get('from')), from);
    assert.ok(matchRoutes(routes, path));
  }
});
test('legacy home links redirect safely and invalid/external return paths remain rejected', () => {
  assert.equal(legacyHomePath(''), '/companies');
  assert.equal(
    legacyHomePath('?company=GOOG'),
    companyPath('GOOG', '/companies'),
  );
  assert.equal(legacyHomePath('?company=%invalid'), '/companies');
  for (const path of [
    'https://example.com',
    '//example.com',
    '/companies/GOOG',
    '/favorites-else',
    '/mergers',
  ])
    assert.equal(listReturnPath(path), '/companies');
  assert.equal(listReturnPath(null), '/companies');
});
test('URL-backed list filters restore search, pagination and annual/quarterly mode without reading global history', () => {
  assert.deepEqual(
    listFilters(new URLSearchParams('page=2&q=Alphabet&mode=quarterly')),
    { page: 2, query: 'Alphabet', mode: 'quarterly' },
  );
  for (const value of ['-1', '0', '1.5', 'Infinity', 'invalid'])
    assert.equal(listFilters(new URLSearchParams({ page: value })).page, 1);
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/favorites?page=2&q=Alphabet&mode=quarterly'] },
      createElement(CompanyListPage, {
        favorites: true,
        onOpen() {},
        onValuation() {},
      }),
    ),
  );
  assert.ok(html.includes('我的收藏'));
  assert.ok(html.includes('value="Alphabet"'));
  assert.ok(html.includes('最新独立季度'));
});
