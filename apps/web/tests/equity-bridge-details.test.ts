import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  emptyBridgeResearch,
  equityDefaultEstimates,
  calculateDcf,
  emptyEquityBridge,
  evaluateEquityBridge,
  type EquityBridgeReferences,
  type ResearchReferenceKey,
  type EquityBridgeResearch,
  type ValuationBaseline,
  type ValuationReferences,
} from '@company-research/shared';
import { EquityBridgeDetails } from '../src/EquityBridgeDetails.js';
import {
  editableBridge,
  editBridgeItem,
  bridgeMoney,
  referenceBridgeResearch,
  setTableBridgeAmount,
  visibleBridgeFacts,
  bridgeWithDefaults,
  restoreBridgeDefault,
  usesDefaultEstimate,
} from '../src/equity-bridge-editor.js';
import { DcfCalculator } from '../src/ValuationPage.js';
import {
  calculatorInput,
  initialScenario,
} from '../src/valuation-calculator.js';
function references(): EquityBridgeReferences {
  const keys: ResearchReferenceKey[] = [
    'cash',
    'shortInvestments',
    'longInvestments',
    'financingDebt',
    'minority',
    'preferred',
    'otherClaims',
    'shares',
    'shortDebt',
    'longDebt',
    'plainDebt',
    'financeLeases',
    'operatingLeases',
    'narrowMinority',
    'convertiblePreferred',
    'lossContingencies',
    'taxClaims',
    'pensionClaims',
    'annualBasicShares',
    'annualDilutedShares',
    'quarterBasicShares',
    'quarterDilutedShares',
  ];
  return {
    version: 1,
    cik: '0001652044',
    asOf: '2026-09-30',
    fingerprint: 'source-1',
    financingDebtIncludesLeases: true,
    facts: Object.fromEntries(
      keys.map((k) => [
        k,
        {
          value: null,
          start: null,
          end: '2026-09-30',
          concept: null,
          items: [],
          status: 'MISSING',
          reason: '未核准',
        },
      ]),
    ) as unknown as EquityBridgeReferences['facts'],
  };
}
function view(refs = references(), research = referenceBridgeResearch(refs)) {
  const data = {
    ticker: 'GOOGL',
    cik: refs.cik,
    asOf: refs.asOf,
  } as ValuationBaseline;
  const reference = {
    periodEnd: refs.asOf,
    cash: null,
    debt: null,
    shares: null,
    sharesBasis: 'unknown',
    sources: {},
    equityBridge: refs,
  } as ValuationReferences;
  return renderToStaticMarkup(
    createElement(EquityBridgeDetails, {
      baseline: data,
      references: reference,
      result: null,
      bridge: { ...emptyEquityBridge(), research },
    }),
  );
}
test('compact four-column bridge shows numbers by default and seven edit/restore actions', () => {
  const html = view();
  assert.equal((html.match(/<th\b/g) ?? []).length, 4);
  for (const text of [
    'SEC财报金额',
    '估值调整 / 结果',
    '股权内在价值',
    '短期有息债务',
    '长期有息债务',
    '每股内在价值',
    '暂不能计算每股内在价值',
    '股权价值 = EV + 可加回的非经营性资产',
    '每股内在价值 = 股权价值 ÷ 适用股数',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes('恢复参考值'));
  assert.ok(!html.includes('ant-input-number'));
  assert.ok(html.includes('操作'));
  assert.equal((html.match(/>编辑</g) ?? []).length, 7);
  assert.equal((html.match(/>恢复默认</g) ?? []).length, 7);
  assert.ok(!html.includes('>状态</th>'));
  assert.ok(!html.includes('value="0"'));
  assert.ok(!html.includes('初步估值参考'));
  assert.ok(html.includes('dcf-bridge-table'));
  assert.ok(html.includes('text-align:right'));
  assert.ok(!html.includes('ant-checkbox'));
  assert.ok(!html.includes('ant-statistic'));
  assert.ok(!html.includes('调整依据及来源'));
  assert.ok(!html.includes('owner-earnings-ocf-v1'));
});
test('audited values, independent annual/quarter share periods, and finance-lease composition appear without automatic estimates', () => {
  const refs = references();
  for (const [key, value] of Object.entries({
    cash: 56334,
    shortInvestments: 208764,
    longInvestments: 135230,
    financingDebt: 129823,
    financeLeases: 3705,
    operatingLeases: 20508,
    narrowMinority: 6900,
    convertiblePreferred: 18023,
    shares: 12294,
    quarterDilutedShares: 12368,
    annualDilutedShares: 12450,
  }))
    Object.assign(refs.facts[key as ResearchReferenceKey], {
      value: value * 1e6,
      status: 'DISCLOSED',
    });
  refs.facts.financingDebt.status = 'VERIFIED';
  refs.facts.annualDilutedShares.start = '2025-01-01';
  refs.facts.annualDilutedShares.end = '2025-12-31';
  refs.facts.quarterDilutedShares.start = '2026-07-01';
  const html = view(refs);
  for (const v of [
    '56,334',
    '208,764',
    '135,230',
    '129,823',
    '3,705',
    '20,508',
    '6,900',
    '18,023',
    '12,294',
    '12,368',
  ])
    assert.ok(html.includes(v), v);
  assert.ok(!html.includes('2025-01-01'));
  assert.ok(!html.includes('2026-07-01'));
  assert.equal(refs.facts.annualDilutedShares.start, '2025-01-01');
  assert.equal(refs.facts.quarterDilutedShares.start, '2026-07-01');
  assert.ok(!html.includes('12,450'));
  assert.ok(!html.includes('养老金缺口：—'));
  assert.equal(visibleBridgeFacts(refs, 'financingDebt').length, 1);
});
test('zero is different from missing, source changes and companies isolate drafts, and money has no pointless decimals', () => {
  const refs = references();
  refs.facts.cash.value = 0;
  const r = emptyBridgeResearch(refs);
  assert.equal(bridgeMoney(0), '0');
  assert.equal(bridgeMoney(1000), '1,000');
  assert.equal(bridgeMoney(-1234.567), '-1,234.57');
  assert.equal(bridgeMoney(null), '—');
  const changed = editBridgeItem(r, 'cash', {
    treatment: 'manual',
    value: 0,
    rationale: 'test-only',
  });
  assert.equal(r.items.cash.value, null);
  const matching = editableBridge(
    refs,
    { ticker: 'GOOGL', research: changed },
    'GOOGL',
  );
  assert.equal(matching.research.items.cash.value, 0);
  const other = editableBridge(
    { ...refs, cik: '0000320193', fingerprint: 'source-2' },
    { ticker: 'GOOGL', research: changed },
    'AAPL',
  );
  assert.equal(other.research.items.cash.treatment, 'pending');
  const refreshed = editableBridge(
    { ...refs, fingerprint: 'new' },
    { ticker: 'GOOGL', research: changed },
    'GOOGL',
  );
  assert.equal(refreshed.research.items.cash.value, null);
  assert.equal(DcfCalculator({ ticker: 'GOOGL' }).key, 'GOOGL');
  assert.equal(DcfCalculator({ ticker: 'AAPL' }).key, 'AAPL');
});
test('each edit changes the single engine input immediately without upgrading manual assumptions to SEC facts', () => {
  const refs = references();
  refs.facts.cash.value = 100e6;
  const r: EquityBridgeResearch = editBridgeItem(
    emptyBridgeResearch(refs),
    'cash',
    { treatment: 'manual', value: 25, rationale: 'test operating cash' },
  );
  const first = evaluateEquityBridge({ ...emptyEquityBridge(), research: r });
  assert.equal(first.research?.values.cash, 75);
  assert.equal(first.research?.states.cash, '用户估计');
  const next = evaluateEquityBridge({
    ...emptyEquityBridge(),
    research: editBridgeItem(r, 'cash', { value: 30 }),
  });
  assert.equal(next.research?.values.cash, 70);
  assert.equal(next.nonOperatingAssets, null);
  assert.ok(next.errors.length > 0);
});

test('only approved financing debt initializes; judgment-dependent assets, claims and shares remain pending', () => {
  const refs = references();
  for (const [key, value] of Object.entries({
    cash: 100,
    shortInvestments: 20,
    longInvestments: 40,
    financingDebt: 30,
    financeLeases: 5,
    shares: 10,
    minority: 2,
    preferred: 3,
  }))
    Object.assign(refs.facts[key as ResearchReferenceKey], {
      value: value * 1e6,
      status: 'VERIFIED',
    });
  const before = JSON.stringify(refs);
  const r = referenceBridgeResearch(refs);
  assert.notEqual(r.preliminary, true);
  assert.equal(r.items.financingDebt.value, 30);
  assert.equal(r.items.financingDebt.treatment, 'reference');
  for (const key of [
    'cash',
    'shortInvestments',
    'longInvestments',
    'minority',
    'preferred',
    'otherClaims',
    'shares',
  ] as const) {
    assert.equal(r.items[key].value, null);
    assert.equal(r.items[key].treatment, 'pending');
  }
  const result = evaluateEquityBridge({ ...emptyEquityBridge(), research: r });
  assert.equal(result.research?.values.financingDebt, 30);
  assert.equal(result.nonOperatingAssets, null);
  assert.equal(result.dilutedShares, null);
  const html = view(refs, r);
  const debtRow =
    html.match(/data-row-key="financingDebt"[\s\S]*?<\/tr>/)?.[0] ?? '';
  assert.ok(debtRow.includes('30'));
  assert.ok(!debtRow.includes('ant-input-number'));
  assert.equal(JSON.stringify(refs), before);
  for (const changed of [
    { ...refs, financingDebtIncludesLeases: null },
    {
      ...refs,
      facts: {
        ...refs.facts,
        financingDebt: {
          ...refs.facts.financingDebt,
          status: 'MISSING' as const,
        },
      },
    },
  ])
    assert.equal(
      referenceBridgeResearch(changed).items.financingDebt.value,
      null,
    );
  const zero = referenceBridgeResearch({
    ...refs,
    facts: {
      ...refs.facts,
      financingDebt: { ...refs.facts.financingDebt, value: 0 },
    },
  });
  assert.equal(zero.items.financingDebt.value, 0);
});
test('incomplete debt and missing current shares never get synthetic defaults', () => {
  const r = referenceBridgeResearch(references());
  assert.equal(r.items.financingDebt.value, null);
  assert.equal(r.items.shares.value, null);
  assert.equal(r.items.preferred.value, null);
  const result = evaluateEquityBridge({ ...emptyEquityBridge(), research: r });
  assert.equal(result.dilutedShares, null);
  assert.ok(result.errors.some((x) => x.includes('融资债务')));
});

test('direct table inputs calculate with the existing strict bridge only when all required estimates are explicit', () => {
  const refs = references();
  for (const [key, value] of Object.entries({
    cash: 100,
    shortInvestments: 20,
    financingDebt: 30,
    financeLeases: 5,
  }))
    Object.assign(refs.facts[key as ResearchReferenceKey], {
      value: value * 1e6,
      status: 'VERIFIED',
    });
  const before = JSON.stringify(refs);
  let r = referenceBridgeResearch(refs);
  const evaluate = (x: EquityBridgeResearch) =>
    evaluateEquityBridge({ ...emptyEquityBridge(), research: x });
  for (const [key, value] of Object.entries({
    cash: 60,
    shortInvestments: 10,
    longInvestments: 0,
    minority: 2,
    preferred: 3,
    otherClaims: 0,
  }))
    r = setTableBridgeAmount(r, key as keyof typeof r.items, value);
  assert.equal(evaluate(r).dilutedShares, null);
  r = setTableBridgeAmount(r, 'shares', 10);
  assert.equal(r.assetsReviewed, false);
  assert.equal(r.claimsReviewed, false);
  const out = evaluate(r);
  assert.deepEqual(out.errors, []);
  assert.equal(out.nonOperatingAssets, 70);
  assert.equal(out.debt, 30);
  assert.equal(out.otherClaims, 5);
  assert.equal(out.dilutedShares, 10);
  assert.equal(
    evaluate(setTableBridgeAmount(r, 'cash', 80)).nonOperatingAssets,
    90,
  );
  assert.equal(
    evaluate(setTableBridgeAmount(r, 'cash', 101)).nonOperatingAssets,
    null,
  );
  assert.equal(
    evaluate(setTableBridgeAmount(r, 'shortInvestments', 21))
      .nonOperatingAssets,
    null,
  );
  assert.equal(
    evaluate(setTableBridgeAmount(r, 'shares', 0)).dilutedShares,
    null,
  );
  assert.equal(
    evaluate(setTableBridgeAmount(r, 'preferred', null)).otherClaims,
    null,
  );
  assert.equal(
    evaluate(setTableBridgeAmount(r, 'otherClaims', -1)).otherClaims,
    null,
  );
  assert.equal(JSON.stringify(refs), before);
});
test('compact source selection keeps valid facts and the latest diluted period without duplicate candidates', () => {
  const refs = references();
  for (const [key, value] of Object.entries({
    minority: 20,
    narrowMinority: 5,
    preferred: 0,
    convertiblePreferred: 10,
    shares: 100,
    annualDilutedShares: 110,
    quarterDilutedShares: 120,
    taxClaims: 0,
  }))
    Object.assign(refs.facts[key as ResearchReferenceKey], {
      value: value * 1e6,
      status: 'DISCLOSED',
    });
  refs.facts.annualDilutedShares.end = '2025-12-31';
  refs.facts.quarterDilutedShares.end = '2026-09-30';
  assert.deepEqual(visibleBridgeFacts(refs, 'minority'), ['minority']);
  assert.deepEqual(visibleBridgeFacts(refs, 'preferred'), [
    'convertiblePreferred',
  ]);
  assert.deepEqual(visibleBridgeFacts(refs, 'otherClaims'), ['taxClaims']);
  assert.deepEqual(visibleBridgeFacts(refs, 'shares'), [
    'shares',
    'quarterDilutedShares',
  ]);
  refs.facts.quarterDilutedShares.value = null;
  assert.deepEqual(visibleBridgeFacts(refs, 'shares'), ['shares']);
  assert.deepEqual(visibleBridgeFacts(refs, 'financingDebt'), []);
});

test('default estimates, manual overrides and row restoration remain separate and source changes isolate drafts', () => {
  const refs = references();
  refs.facts.cash.value = 100e6;
  Object.assign(refs.facts.financingDebt, { value: 30e6, status: 'VERIFIED' });
  const defs = equityDefaultEstimates({ references: refs, baseline: null });
  defs.cash = { ...defs.cash, value: 80, reason: null };
  defs.shares = { ...defs.shares, value: 10, reason: null };
  let r = bridgeWithDefaults(refs, null, 'TEST', defs).research;
  assert.equal(r.items.cash.value, 80);
  assert.equal(usesDefaultEstimate(r, 'cash'), true);
  assert.equal(r.items.preferred.value, null);
  r = setTableBridgeAmount(r, 'cash', 60);
  assert.equal(usesDefaultEstimate(r, 'cash'), false);
  const changedDefaults = { ...defs, cash: { ...defs.cash, value: 70 } };
  const same = bridgeWithDefaults(
    refs,
    { ticker: 'TEST', research: r },
    'TEST',
    changedDefaults,
  ).research;
  assert.equal(same.items.cash.value, 60);
  assert.equal(
    restoreBridgeDefault(same, 'cash', changedDefaults.cash).items.cash.value,
    70,
  );
  const cleared = setTableBridgeAmount(r, 'cash', null);
  assert.equal(
    bridgeWithDefaults(
      refs,
      { ticker: 'TEST', research: cleared },
      'TEST',
      defs,
    ).research.items.cash.value,
    null,
  );
  assert.equal(
    bridgeWithDefaults(
      { ...refs, fingerprint: 'changed' },
      { ticker: 'TEST', research: r },
      'TEST',
      defs,
    ).research.items.cash.value,
    80,
  );
  assert.equal(refs.facts.cash.value, 100e6);
  for (const [key, value] of Object.entries({
    shortInvestments: 10,
    longInvestments: 0,
    minority: 2,
    preferred: 3,
    otherClaims: 0,
  }))
    r = setTableBridgeAmount(r, key as keyof typeof r.items, value);
  refs.facts.shortInvestments.value = 20e6;
  const baseline: ValuationBaseline = {
    ticker: 'TEST',
    cik: refs.cik,
    name: null,
    asOf: refs.asOf,
    checkedAt: '2026-11-25',
    applicable: true,
    status: 'REVIEW_REQUIRED',
    warnings: [],
    fcff: 100e6,
    fcf: 100e6,
    revenue: refs.facts.cash,
    ocf: refs.facts.cash,
    capex: refs.facts.cash,
    ebit: refs.facts.cash,
    interest: refs.facts.cash,
  };
  const run = (research: EquityBridgeResearch) =>
    calculateDcf(
      calculatorInput(baseline, {
        ...initialScenario,
        useResearch: false,
        researchValue: null,
        researchReason: '',
        bridge: { ...emptyEquityBridge(), research },
      }),
    );
  const out = run(r);
  assert.equal(out.equity, out.ev! + 35);
  assert.equal(out.perShare, out.equity! / 10);
  const reset = run(restoreBridgeDefault(r, 'cash', defs.cash));
  assert.equal(reset.ev, out.ev);
  assert.equal(reset.equity, out.equity! + 20);
});

test('equity bridge keeps the preliminary nonoperating-income limitation visible', () => {
  assert.match(
    view(),
    /当前FCFF尚未完成非经营性收益调整，估值可能存在重复计价，仅作为初步研究参考/,
  );
});
