import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ValuationBaseline,
  BridgeDisclosureKey,
  ValuationFact,
} from '@company-research/shared';
import { EquityBridgeDetails } from '../src/EquityBridgeDetails.js';
const unknown: ValuationFact = {
  value: null,
  start: null,
  end: '2026-09-30',
  concept: null,
  items: [],
};
const baseline = {
  ticker: 'TEST',
  cik: '0000000001',
  asOf: '2026-09-30',
  bridgeDisclosures: {
    version: 1,
    cik: '0000000001',
    asOf: '2026-09-30',
    items: {} as Record<BridgeDisclosureKey, ValuationFact>,
  },
} as ValuationBaseline;
function render(values: Partial<Record<BridgeDisclosureKey, number | null>>) {
  const items = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { ...unknown, value }]),
  ) as Record<BridgeDisclosureKey, ValuationFact>;
  const data = {
    ...baseline,
    bridgeDisclosures: { ...baseline.bridgeDisclosures!, items },
  };
  return renderToStaticMarkup(
    createElement(EquityBridgeDetails, {
      baseline: data,
      references: null,
      result: null,
    }),
  );
}
test('shows disclosed amounts but leaves their unapproved adjustments and final values blank', () => {
  const html = render({
    cash: 123e6,
    convertiblePreferred: 45e6,
    noncontrollingVIE: 6e6,
    longTermInvestments: 77e6,
  });
  for (const text of [
    '123.00',
    '45.00',
    '6.00',
    '77.00',
    '需估算',
    '待确认',
    '股权价值 = EV',
    '每股内在价值 =',
    'SEC财报金额',
    '估值调整 / 结果',
  ])
    assert.ok(html.includes(text), text);
  for (const key of [
    'cash',
    'investments',
    'preferred',
    'minority',
    'equity',
    'perShare',
  ]) {
    const row = html.match(
      new RegExp(`<tr[^>]*data-row-key="${key}"[\\s\\S]*?</tr>`),
    )?.[0];
    assert.ok(row, key);
    assert.match(row, /text-align:right[^>]*>—<\/td>/);
  }
  assert.ok(!html.includes('<input'));
});
test('reported zero remains visible; unknown claims never become zero or automatically not applicable', () => {
  const html = render({ shortDebt: 0 });
  assert.ok(html.includes('0.00'));
  const unknownRow = html.match(
    /<tr[^>]*data-row-key="preferred"[\s\S]*?<\/tr>/,
  )?.[0];
  assert.ok(unknownRow?.includes('未找到'));
  assert.ok(!unknownRow?.includes('0.00'));
  assert.ok(!html.includes('不适用'));
});
test('does not reuse disclosures from another reporting period or another company', () => {
  for (const patch of [{ asOf: '2025-09-30' }, { cik: '0000000002' }]) {
    const data = {
      ...baseline,
      bridgeDisclosures: {
        ...baseline.bridgeDisclosures!,
        ...patch,
        items: { cash: { ...unknown, value: 999e6 } } as Record<
          BridgeDisclosureKey,
          ValuationFact
        >,
      },
    };
    const html = renderToStaticMarkup(
      createElement(EquityBridgeDetails, {
        baseline: data,
        references: null,
        result: null,
      }),
    );
    assert.ok(!html.includes('999.00'));
  }
});

test('four-column uncollapsed table presents audited SEC amounts with scoped NCI/preferred mappings, without adding any adjustments', () => {
  // Audited GOOGL 2026-Q3 regression inputs. Production components contain no company values.
  const html = render({
    cash: 56334e6,
    securities: 208764e6,
    longTermInvestments: 135230e6,
    shortDebt: 1016e6,
    longDebt: 125102e6,
    operatingLeases: 20508e6,
    financeLeases: 3705e6,
    noncontrollingVIE: 6900e6,
    convertiblePreferred: 18023e6,
    commonShares: 12294e6,
    dilutedShares: 12368e6,
  });
  assert.equal((html.match(/<th\b/g) ?? []).length, 4);
  assert.equal((html.match(/data-row-key=/g) ?? []).length, 13);
  assert.ok(!html.includes('<details'));
  assert.ok(!html.includes('处理说明</th>'));
  for (const [key, value] of Object.entries({
    cash: '56,334.00',
    securities: '208,764.00',
    investments: '135,230.00',
    shortDebt: '1,016.00',
    longDebt: '125,102.00',
    operatingLeases: '20,508.00',
    financeLeases: '3,705.00',
    minority: '6,900.00',
    preferred: '18,023.00',
    shares: '12,368.00',
  })) {
    const row = html.match(
      new RegExp(`<tr[^>]*data-row-key="${key}"[\\s\\S]*?</tr>`),
    )?.[0];
    assert.ok(row?.includes(value), key);
    assert.match(row!, /text-align:right[^>]*>—<\/td>/);
  }
  assert.ok(html.includes('12,294.00'));
  assert.ok(html.includes('需估算'));
});
