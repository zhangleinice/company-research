import { afterEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchResearchList,
  fetchCompanyDetail,
  setCompanyFavorite,
} from '../src/api.js';

afterEach(() => mock.restoreAll());
test('loads ten directory rows with server-side search and mode, without detail requests', async () => {
  const payload = { page: 2, limit: 10, total: 3, mode: 'quarterly', data: [] };
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify(payload)),
  );
  assert.deepEqual(
    await fetchResearchList({
      page: 2,
      q: 'A&B',
      mode: 'quarterly',
      favorites: false,
    }),
    payload,
  );
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    '/api/companies?page=2&limit=10&q=A%26B&mode=quarterly',
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});
test('uses the independent favorites endpoint', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}'),
  );
  await fetchResearchList({ page: 1, q: '', mode: 'annual', favorites: true });
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    '/api/companies/favorites?page=1&limit=10&q=&mode=annual',
  );
});
test('passes cancellation to the list request', async () => {
  const controller = new AbortController();
  mock.method(
    globalThis,
    'fetch',
    async (_url: string, options?: RequestInit) => {
      assert.equal(options?.signal, controller.signal);
      throw new DOMException('Aborted', 'AbortError');
    },
  );
  await assert.rejects(
    fetchResearchList(
      { page: 1, q: '', mode: 'annual', favorites: false },
      controller.signal,
    ),
    { name: 'AbortError' },
  );
});
test('acquires company details only through the backend detail endpoint', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ ticker: 'GOOG', annual: [], quarterly: [] }),
      ),
  );
  await fetchCompanyDetail('GOOG');
  assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/companies/GOOG');
});
test('favorites by CIK using PATCH without requesting detail data', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}'),
  );
  await setCompanyFavorite('0001652044', true);
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    '/api/companies/0001652044/favorite',
  );
  assert.deepEqual(fetchMock.mock.calls[0].arguments[1], {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{"isFavorite":true}',
  });
});
test('propagates retryable SEC failures and invalid backend JSON', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ message: 'SEC timeout' }), { status: 504 }),
  );
  await assert.rejects(fetchCompanyDetail('KO'), /SEC timeout/);
  fetchMock.mock.mockImplementation(
    async () => new Response('<html>bad gateway</html>', { status: 502 }),
  );
  await assert.rejects(
    fetchResearchList({ page: 1, q: '', mode: 'annual', favorites: false }),
    /无效 JSON/,
  );
});
