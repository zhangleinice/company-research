import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  OwnerEarningsFact,
  OwnerEarningsResponse,
  OwnerEarningsYear,
  OwnerEarningsDraft,
  OwnerEarningsResults,
  OwnerEarningsPreview,
} from '@company-research/shared';
import {
  OwnerEarningsTrends,
  OwnerEarningsView,
  ownerDraft,
  ownerMoney,
  OwnerEarnings,
} from '../src/OwnerEarnings.js';
import {
  fetchOwnerEarnings,
  saveOwnerEarnings,
  previewOwnerEarnings,
} from '../src/api.js';
import {
  OwnerPreviewScheduler,
  validOwnerInput,
  ownerPreviewKey,
} from '../src/owner-earnings-preview.js';
const fact = (value: number | null): OwnerEarningsFact => ({
  value,
  reason: value === null ? '输入未核准' : null,
  sources: [],
});
const year = (fy: number): OwnerEarningsYear => ({
  fiscalYear: fy,
  periodStart: `${fy}-01-01`,
  periodEnd: `${fy}-12-31`,
  currency: 'USD',
  dataVersion: 'a'.repeat(64),
  netIncomeScope: 'parent',
  netIncome: fact(100e6),
  operatingCashFlow: fact(100e6),
  depreciationAmortization: fact(null),
  capex: fact(60e6),
  fcf: fact(40e6),
  sbc: fact(10e6),
  revenue: fact(200e6),
  capexToRevenue: 30,
  daToRevenue: null,
});
function data(): OwnerEarningsResponse {
  return {
    cik: '0000000001',
    ticker: 'TEST',
    policyVersion: 'owner-earnings-ocf-v1',
    history: [year(2025), year(2024), year(2023)],
    estimate: null,
    estimateStatus: 'none',
    results: {
      maintenanceCapex: null,
      growthCapex: null,
      growthReason: '待确认',
      ownerEarnings: null,
      sbcAdjustedOwnerEarnings: null,
    },
  };
}
const render = (
  d: OwnerEarningsResponse,
  dirty = false,
  preview: OwnerEarningsResults | null = null,
  draft = ownerDraft(d),
) =>
  renderToStaticMarkup(
    createElement(OwnerEarningsView, {
      data: d,
      draft,
      dirty,
      preview,
      onChange: () => {},
      onSave: () => {},
    }),
  );
afterEach(() => mock.restoreAll());
test('annual-only structure, six metrics, no defaults, source scope, and no DCF replacement', () => {
  const d = data(),
    html = render(d);
  assert.equal(ownerDraft(d)?.ratio, null);
  assert.equal(ownerDraft(d)?.amount, null);
  for (const name of [
    'Historical Financial Data',
    'Historical Trends',
    'Maintenance CapEx Estimation',
    'Estimated Owner Earnings',
    'SBC-adjusted Owner Earnings',
  ])
    assert.ok(html.includes(name));
  assert.ok(html.includes('不直接用于现有 FCFF DCF'));
  assert.ok(html.includes('尚未估计'));
  assert.ok(!html.includes(d.policyVersion));
  assert.ok(!html.includes('type="checkbox"'));
  assert.ok(html.includes('确认并保存估计'));
  assert.equal((html.match(/<input[^>]*value="50"/g) ?? []).length, 0);
  assert.ok(!html.includes('TTM切换'));
});
test('saved results, unsaved modification previews and changed-baseline previews remain distinct', () => {
  const d = data();
  d.results = {
    maintenanceCapex: 30e6,
    growthCapex: 30e6,
    growthReason: null,
    ownerEarnings: 70e6,
    sbcAdjustedOwnerEarnings: 60e6,
  };
  d.estimateStatus = 'confirmed';
  d.estimate = {
    ...ownerDraft(d)!,
    method: 'ratio',
    ratio: 50,
    comparable: true,
    cik: d.cik,
    fiscalYear: 2025,
    capexBasis: 60e6,
    policyVersion: d.policyVersion,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  assert.ok(render(d).includes('>70<'));
  assert.ok(render(d).includes('已保存'));
  assert.ok(!render(d, true).includes('>70<'));
  assert.ok(render(d, true, d.results).includes('>70<'));
  assert.ok(render(d, true, d.results).includes('未保存的修改'));
  d.estimateStatus = 'needs_reconfirmation';
  assert.ok(!render(d).includes('>70<'));
  assert.ok(render(d, false, d.results).includes('>70<'));
  assert.ok(render(d).includes('数据已变化，待重新确认'));
});
test('full annual coordinates, missing gaps, isolated points and indicator selectors', () => {
  const d = data();
  d.history[1].operatingCashFlow.value = null;
  d.history[1].capex.value = null;
  d.history[1].fcf.value = null;
  d.history.forEach((y) => {
    y.capexToRevenue = null;
  });
  d.history[0].daToRevenue = 12.5;
  const html = renderToStaticMarkup(
    createElement(OwnerEarningsTrends, { history: d.history }),
  );
  assert.equal((html.match(/data-period-end=/g) ?? []).length, 6);
  assert.equal((html.match(/<line[^>]*stroke="#1677ff"/g) ?? []).length, 0);
  assert.equal((html.match(/<circle[^>]*fill="#9254de"/g) ?? []).length, 1);
  assert.ok(html.includes('FY 2025'));
  assert.ok(html.includes('2025-01-01 至 2025-12-31'));
  assert.ok(html.includes('全部对比'));
  assert.ok(html.includes('CapEx / Revenue'));
  assert.ok(html.includes('D&amp;A / Revenue'));
});
test('all missing histories retain coordinates, and empty cache remains explicit', () => {
  const d = data();
  d.history.forEach((y) => {
    y.operatingCashFlow.value = null;
    y.capex.value = null;
    y.fcf.value = null;
    y.capexToRevenue = null;
  });
  assert.ok(render(d).includes('保留完整报告期间'));
  d.history = [];
  assert.equal(ownerDraft(d), null);
  assert.ok(render(d).includes('未请求SEC数据'));
});
test('cache-only API and explicit save send full isolated annual draft, including zero', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const d = data();
  mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(d), { status: 200 });
  });
  await fetchOwnerEarnings(d.cik);
  const draft = {
    ...ownerDraft(d)!,
    method: 'amount' as const,
    ratio: null,
    amount: 0,
    comparable: false,
  };
  await saveOwnerEarnings(d.cik, draft);
  await previewOwnerEarnings(d.cik, draft);
  assert.equal(calls[0].url, `/api/companies/${d.cik}/owner-earnings`);
  assert.equal(calls[1].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), draft);
  assert.equal(calls[2].url, `/api/companies/${d.cik}/owner-earnings/preview`);
  assert.equal(calls[2].init?.method, 'POST');
  assert.ok(
    calls.every(
      (c) => !c.url.includes('refresh') && !c.url.includes('sec.gov'),
    ),
  );
});

test('amount preview needs no scope confirmation for earnings, ratio mode has no checkbox, and formatting preserves precision only for display', () => {
  const d = data(),
    result = {
      maintenanceCapex: 30e6,
      growthCapex: null,
      growthReason: '无法可靠拆分',
      ownerEarnings: 70e6,
      sbcAdjustedOwnerEarnings: 60e6,
    };
  const draft: OwnerEarningsDraft = {
    ...ownerDraft(d)!,
    method: 'amount',
    ratio: null,
    amount: 30,
    comparable: false,
  };
  const html = render(d, true, result, draft);
  assert.ok(html.includes('>70<'));
  assert.ok(html.includes('未保存的估计预览'));
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(html.includes('无法可靠拆分'));
  assert.ok(
    !render(d, true, result, {
      ...draft,
      method: 'ratio',
      amount: null,
      ratio: 50,
    }).includes('type="checkbox"'),
  );
  for (const [n, expected] of [
    [0, '0'],
    [-10e6, '-10'],
    [1234e6, '1,234'],
    [1234.567e6, '1,234.57'],
    [1.2e6, '1.2'],
    [null, '—'],
  ] as const)
    assert.equal(ownerMoney(n), expected);
  assert.ok(
    !renderToStaticMarkup(
      createElement(OwnerEarnings, { identifier: d.cik }),
    ).includes('重读已存数据'),
  );
});
test('input validation distinguishes empty, zero, invalid and missing CapEx without calculating finances in the browser', () => {
  const d = data(),
    draft = ownerDraft(d)!;
  assert.equal(validOwnerInput(draft, d.history[0]), false);
  for (const ratio of [0, 50, 100, 12.34])
    assert.equal(validOwnerInput({ ...draft, ratio }, d.history[0]), true);
  for (const ratio of [-1, 101, NaN, Infinity])
    assert.equal(validOwnerInput({ ...draft, ratio }, d.history[0]), false);
  d.history[0].capex.value = null;
  assert.equal(validOwnerInput({ ...draft, ratio: 50 }, d.history[0]), false);
  assert.equal(
    validOwnerInput({ ...draft, method: 'amount', amount: 0 }, d.history[0]),
    true,
  );
  assert.notEqual(ownerPreviewKey('ONE', draft), ownerPreviewKey('TWO', draft));
});
test('debounced preview ignores late success/error responses and cancellation on edits, save or unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending: {
    resolve: (p: OwnerEarningsPreview) => void;
    reject: (e: Error) => void;
    signal?: AbortSignal;
  }[] = [];
  const request = async (
    _identifier: string,
    _draft: OwnerEarningsDraft,
    signal?: AbortSignal,
  ) =>
    new Promise<OwnerEarningsPreview>((resolve, reject) =>
      pending.push({ resolve, reject, signal }),
    );
  const scheduler = new OwnerPreviewScheduler(request),
    d = data(),
    draft = { ...ownerDraft(d)!, ratio: 50 };
  const received: OwnerEarningsPreview[] = [],
    errors: unknown[] = [];
  scheduler.schedule(
    'ONE',
    draft,
    (p) => received.push(p),
    (e) => errors.push(e),
  );
  t.mock.timers.tick(249);
  assert.equal(pending.length, 0);
  t.mock.timers.tick(1);
  assert.equal(pending.length, 1);
  scheduler.schedule(
    'ONE',
    { ...draft, ratio: 60 },
    (p) => received.push(p),
    (e) => errors.push(e),
  );
  assert.equal(pending[0].signal?.aborted, true);
  t.mock.timers.tick(250);
  assert.equal(pending.length, 2);
  const response = { data: d, results: d.results };
  pending[1].resolve(response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
  pending[0].resolve(response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
  scheduler.schedule(
    'TWO',
    draft,
    (p) => received.push(p),
    (e) => errors.push(e),
  );
  t.mock.timers.tick(250);
  scheduler.cancel();
  pending[2].reject(new Error('late failure'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 0);
  scheduler.schedule(
    'ONE',
    draft,
    (p) => received.push(p),
    (e) => errors.push(e),
  );
  scheduler.cancel();
  t.mock.timers.tick(250);
  assert.equal(pending.length, 3);
});
