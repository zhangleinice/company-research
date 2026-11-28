import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type {
  EnterpriseQuality,
  ValuationFact,
} from '@company-research/shared';
import { fetchEnterpriseQuality } from '../src/services/api.js';
afterEach(() => mock.restoreAll());
const missing: ValuationFact = {
  value: null,
  start: null,
  end: '',
  concept: null,
  items: [],
};
const data: EnterpriseQuality = {
  version: 1,
  ticker: 'TEST',
  cik: '0000000001',
  start: '2025-10-01',
  asOf: '2026-09-30',
  applicable: true,
  netIncome: { ...missing, value: 123e6 },
  commonNetIncome: missing,
  depreciationAmortization: missing,
  depreciation: missing,
  amortization: missing,
  capex: { ...missing, value: 0 },
  ebit: { ...missing, value: 200e6 },
  taxExpense: missing,
  pretaxIncome: missing,
  historicalTaxRate: null,
  capital: [],
};
test('quality requests only the cache endpoint and forwards cancellation', async () => {
  const controller = new AbortController();
  const f = mock.method(
    globalThis,
    'fetch',
    async (_url: string, init?: RequestInit) => {
      assert.equal(init?.signal, controller.signal);
      return new Response(JSON.stringify(data));
    },
  );
  assert.deepEqual(
    await fetchEnterpriseQuality('A&B', controller.signal),
    data,
  );
  assert.equal(
    f.mock.calls[0].arguments[0],
    '/api/companies/A%26B/valuation/quality',
  );
  assert.equal(f.mock.callCount(), 1);
});
