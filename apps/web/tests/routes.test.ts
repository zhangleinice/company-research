import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyPath, listReturnPath, readRoute } from '../src/routes.js';

const route = (path: string) => readRoute(new URL(path, 'http://localhost'));
test('separate list routes and legacy detail links remain accessible', () => {
  assert.equal(route('/companies').listPath, '/companies');
  assert.equal(route('/favorites').listPath, '/favorites');
  assert.equal(route('/?company=GOOG').ticker, 'GOOG');
  assert.equal(route('/companies/BRK.B').ticker, 'BRK.B');
  assert.equal(route('/companies/%invalid').ticker, null);
});
test('detail links retain source list filters across refresh', () => {
  const source = '/favorites?page=2&q=Alphabet&mode=quarterly';
  const detail = route(companyPath('GOOG', source));
  assert.equal(detail.ticker, 'GOOG');
  assert.equal(detail.returnTo, source);
});
test('direct detail links default to directory and reject external return paths', () => {
  assert.equal(route('/companies/GOOG').returnTo, '/companies');
  for (const path of [
    'https://example.com',
    '//example.com',
    '/companies/GOOG',
    '/favorites-else',
  ])
    assert.equal(listReturnPath(path), '/companies');
});
