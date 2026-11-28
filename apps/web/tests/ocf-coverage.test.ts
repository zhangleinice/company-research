import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  capitalSankey,
  type CapitalAllocationOverview,
} from '@company-research/shared';
import { ocfCoverage } from '../src/pages/CompanyDetail/Management/CapitalAllocation/utils/ocf-coverage.js';
import { OcfCoverageView } from '../src/pages/CompanyDetail/Management/CapitalAllocation/components/OcfCoverageView.js';
import { capitalNodeColor } from '../src/pages/CompanyDetail/Management/CapitalAllocation/utils/capital-sankey-options.js';

function overview(): CapitalAllocationOverview {
  return {
    version: 'capital-allocation-overview-v1',
    start: '2025-01-01',
    end: '2025-12-31',
    ocf: 100e6,
    items: [
      ['capex', 20e6],
      ['stockRepurchases', 10e6],
      ['dividendsPaid', 5e6],
      ['acquisitions', 15e6],
    ].map(([key, value]) => ({
      key: key as string,
      label: key as string,
      value: value as number,
      direction: 'outflow',
      ratio: null,
      group: 'operations',
      note: `${key} 实际披露口径`,
      sources: [
        {
          concept: `us-gaap:${key}`,
          unit: 'USD',
          start: '2025-01-01',
          end: '2025-12-31',
          accessionNumber: 'test-filing',
          filed: '2026-02-01',
          url: 'https://www.sec.gov/Archives/test',
        },
      ],
    })),
    reconciliation: {
      status: 'INCOMPLETE',
      sources: [],
      operating: 100e6,
      investing: null,
      financing: null,
      fx: null,
      cashChange: null,
      difference: null,
      note: '主表缺失，不制造平衡',
    },
  };
}
test('complete positive OCF coverage forms a donut summing to OCF without requiring complete financing statements', () => {
  const o = overview(),
    before = JSON.stringify(o),
    model = ocfCoverage(o);
  assert.equal(model.canPie, true);
  assert.equal(model.remainder, 50e6);
  assert.equal(
    model.items.reduce((sum, i) => sum + i.value!, 0),
    o.ocf,
  );
  assert.equal(
    model.items.reduce((sum, i) => sum + i.ratio!, 0),
    100,
  );
  assert.equal(capitalSankey(o).canChart, false);
  assert.deepEqual(
    model.items.map((i) => i.name),
    [
      '资本支出',
      '股票回购',
      '股息分红',
      '收购及相关投资',
      '扣除上述支出后余额',
    ],
  );
  for (const item of model.items.slice(0, 4))
    assert.equal(item.color, capitalNodeColor({ key: item.key }));
  assert.ok(model.items[4].note.includes('不代表实际留存现金'));
  assert.equal(model.items[0].sources[0].accessionNumber, 'test-filing');
  const html = renderToStaticMarkup(
    createElement(OcfCoverageView, { overview: o }),
  );
  assert.ok(html.includes('覆盖环形图'));
  assert.ok(html.includes('50.00%'));
  assert.ok(!html.includes('ocf-coverage-track'));
  assert.equal(JSON.stringify(o), before);
});
test('spending above OCF uses actual bars and a negative remainder without normalization', () => {
  const o = overview();
  o.items[0].value = 120e6;
  const model = ocfCoverage(o);
  assert.equal(model.canPie, false);
  assert.equal(model.insufficient, true);
  assert.equal(model.remainder, -50e6);
  assert.equal(model.items[0].ratio, 120);
  assert.equal(model.items[4].ratio, -50);
  const html = renderToStaticMarkup(
    createElement(OcfCoverageView, { overview: o }),
  );
  assert.ok(html.includes('经营现金流覆盖不足'));
  assert.ok(html.includes('120.00%'));
  assert.ok(html.includes('-50.00%'));
  assert.ok(html.includes('ocf-coverage-track'));
  assert.ok(!html.includes('覆盖环形图'));
});
test('missing, conflicting and mixed-direction core spending never becomes zero or a fabricated remainder', () => {
  for (const invalid of [
    'missing',
    'null',
    'direction',
    'negative',
    'duplicate',
    'nan',
  ]) {
    const o = overview();
    if (invalid === 'missing') o.items.pop();
    if (invalid === 'null') o.items[3].value = null;
    if (invalid === 'direction') o.items[3].direction = 'inflow';
    if (invalid === 'negative') o.items[3].value = -15e6;
    if (invalid === 'duplicate') o.items.push({ ...o.items[3] });
    if (invalid === 'nan') o.items[3].value = NaN;
    const model = ocfCoverage(o);
    assert.equal(model.canPie, false, invalid);
    assert.equal(model.complete, false, invalid);
    assert.equal(model.items[3].value, null, invalid);
    assert.equal(model.remainder, null, invalid);
    assert.equal(model.items[4].ratio, null, invalid);
    assert.equal(model.items[0].ratio, 20, invalid);
  }
  const o = overview();
  o.items[3].value = null;
  const html = renderToStaticMarkup(
    createElement(OcfCoverageView, { overview: o }),
  );
  assert.ok(html.includes('数据不完整'));
  assert.ok(!html.includes('覆盖环形图'));
});
test('zero is preserved, while nonpositive or missing OCF suppresses all percentages and pie', () => {
  const o = overview();
  o.items[3].value = 0;
  assert.equal(ocfCoverage(o).canPie, true);
  assert.equal(ocfCoverage(o).items[3].ratio, 0);
  for (const value of [0, -100e6, null, NaN]) {
    o.ocf = value;
    const model = ocfCoverage(o);
    assert.equal(model.canPie, false);
    assert.ok(model.items.every((i) => i.ratio === null));
    const html = renderToStaticMarkup(
      createElement(OcfCoverageView, { overview: o }),
    );
    assert.ok(html.includes('不计算比例'));
    assert.ok(!html.includes('ocf-coverage-track'));
    assert.ok(!html.includes('NaN'));
  }
  assert.equal(ocfCoverage(undefined).remainder, null);
});
test('debt, financial investments, FX and cash balances are not OCF pie allocations', () => {
  const o = overview(),
    expected = ocfCoverage(o);
  o.items.push(
    ...['debtIn', 'debtOut', 'investBuy', 'investSell', 'fx', 'cashChange'].map(
      (key) => ({ ...o.items[0], key, value: 999999e6 }),
    ),
  );
  assert.deepEqual(ocfCoverage(o), expected);
  o.items[0].value = 70e6;
  const exact = ocfCoverage(o);
  assert.equal(exact.remainder, 0);
  assert.equal(exact.canPie, true);
  assert.equal(exact.items[4].ratio, 0);
});
