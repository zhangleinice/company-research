import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import {
  capitalSankey,
  type FinancialPeriod,
  type CapitalAllocationOverview as Overview,
  type CapitalOverviewItem,
} from '@company-research/shared';
import { CapitalAllocationOverview } from '../src/analysis/CapitalAllocationOverview.js';
import {
  capitalNodeLabel,
  capitalFundsRatio,
  capitalSankeyConfig,
  capitalNodeOrder,
  capitalNodeColor,
  capitalSankeyHeight,
} from '../src/analysis/capital-sankey-options.js';
function fixture(): Overview {
  const flow = (
    key: string,
    value: number,
    direction: CapitalOverviewItem['direction'],
  ): CapitalOverviewItem => ({
    key,
    value,
    ratio: value / 1e6,
    direction,
    label: key,
    group: 'other',
    note: key + ' disclosure',
    sources: [],
  });
  return {
    version: 'capital-allocation-overview-v1',
    start: '2025-01-01',
    end: '2025-12-31',
    ocf: 100e6,
    items: [
      flow('operatingCashFlow', 100e6, 'inflow'),
      flow('capex', 120e6, 'outflow'),
      flow('stockRepurchases', 10e6, 'outflow'),
      flow('dividendsPaid', 20e6, 'outflow'),
      flow('debtIn', 40e6, 'inflow'),
      flow('debtOut', 0, 'outflow'),
      flow('cashChange', -10e6, 'net'),
      flow('fx', 0, 'net'),
    ],
    reconciliation: {
      sources: [],
      status: 'MATCHED',
      operating: 100e6,
      investing: -120e6,
      financing: 10e6,
      fx: 0,
      cashChange: -10e6,
      difference: 0,
      note: 'cash flow statement may include restricted cash',
    },
  };
}
const row = (o: Overview): FinancialPeriod =>
  ({
    periodStart: o.start,
    periodEnd: o.end,
    fiscalYear: 2025,
    fiscalQuarter: null,
    capitalAllocation: { overview: o },
  }) as FinancialPeriod;
test('three layers conserve amounts, use only disclosed cash change and keep >100% OCF proportions', () => {
  const o = fixture(),
    before = JSON.stringify(o),
    m = capitalSankey(o);
  assert.equal(m.canChart, true);
  assert.equal(m.sourceTotal, 150e6);
  assert.equal(m.useTotal, 150e6);
  assert.equal(m.identifiedDifference, 0);
  assert.equal(m.status, 'BALANCED');
  assert.ok(
    m.nodes.find((n) => n.key === 'cash')?.name.includes('动用原有现金'),
  );
  assert.equal(m.nodes.find((n) => n.key === 'cash')?.amount, 10e6);
  assert.equal(m.nodes.find((n) => n.key === 'cash')?.reportedAmount, -10e6);
  assert.equal(m.nodes.find((n) => n.key === 'capex')?.ratio, 120);
  assert.ok(m.zero.includes('偿还债务（披露口径）'));
  const byKey = new Map(m.nodes.map((n) => [n.key, n]));
  for (const l of m.links) {
    assert.equal(byKey.get(l.target)!.layer - byKey.get(l.source)!.layer, 1);
    assert.ok(l.value > 0);
  }
  assert.equal(
    m.links.filter((l) => l.target === 'pool').reduce((s, l) => s + l.value, 0),
    150,
  );
  assert.equal(
    m.links.filter((l) => l.source === 'pool').reduce((s, l) => s + l.value, 0),
    150,
  );
  assert.equal(JSON.stringify(o), before);
  const label = capitalNodeLabel(
    m.nodes.find((n) => n.key === 'capex')!,
    m.sourceTotal,
  );
  assert.ok(label.includes('80.00%'));
  assert.ok(label.includes('120 · 80.00%'));
  assert.ok(!label.includes('百万美元'));
});
test('unidentified investing/financing residuals are explicit, never assigned to cash or FCF', () => {
  const o = fixture();
  o.items.find((x) => x.key === 'capex')!.value = 110e6;
  const m = capitalSankey(o);
  assert.equal(m.status, 'UNIDENTIFIED');
  assert.equal(m.nodes.find((n) => n.key === 'unidentified投资')?.amount, 10e6);
  assert.equal(m.nodes.find((n) => n.key === 'cash')?.amount, 10e6);
  assert.ok(
    m.nodes.find((n) => n.key === 'unidentified投资')?.name.includes('未识别'),
  );
  assert.equal(m.sourceTotal, m.useTotal);
  assert.ok(!m.nodes.some((n) => n.name === '自由现金流'));
});
test('incomplete/conflicting disclosures and duplicate keys cannot be coerced into balanced charts; negative OCF has no ratio', () => {
  assert.equal(capitalSankey(null).canChart, false);
  let o = fixture();
  o.reconciliation.fx = null;
  assert.equal(capitalSankey(o).canChart, false);
  o = fixture();
  o.reconciliation.status = 'CONFLICT';
  assert.equal(capitalSankey(o).canChart, false);
  o = fixture();
  o.items[1].value = null;
  assert.equal(capitalSankey(o).canChart, false);
  o = fixture();
  o.items.push({ ...o.items[1] });
  assert.equal(capitalSankey(o).canChart, false);
  o = fixture();
  o.ocf = -100e6;
  o.reconciliation.operating = -100e6;
  o.reconciliation.cashChange = -210e6;
  const m = capitalSankey(o);
  assert.equal(m.canChart, true);
  assert.ok(m.nodes.every((n) => n.ratio === null));
  assert.equal(m.nodes.find((n) => n.key === 'ocf')?.layer, 2);
});
test('FX is a separate accounting bridge; positive cash movement is a disclosed use and not an inferred residual', () => {
  const o = fixture();
  o.reconciliation.fx = 20e6;
  o.reconciliation.cashChange = 10e6;
  const m = capitalSankey(o);
  assert.equal(m.canChart, true);
  assert.equal(m.nodes.find((n) => n.key === 'fx')?.layer, 0);
  assert.ok(m.nodes.find((n) => n.key === 'fx')?.name.includes('非经营'));
  assert.equal(m.nodes.find((n) => n.key === 'cash')?.layer, 2);
  assert.equal(m.nodes.find((n) => n.key === 'cash')?.name, '现金储备增加');
});
test('latest-year card defaults to OCF coverage, with two view choices and no year selector or repeated table', () => {
  const o = fixture(),
    old = row({ ...o, end: '2024-12-31', start: '2024-01-01' });
  old.fiscalYear = 2024;
  const html = renderToStaticMarkup(
    createElement(CapitalAllocationOverview, { rows: [old, row(o)] }),
  );
  assert.ok(html.includes('FY2025'));
  assert.ok(!html.includes('资本配置财年'));
  assert.ok(!html.includes('combobox'));
  assert.ok(!html.includes('capital-overview-track'));
  assert.ok(!html.includes('<table'));
  assert.ok(html.includes('120.00%'));
  assert.ok(html.includes('总资金流向'));
  const choices = html.match(/<input[^>]+type="radio"[^>]*>/g)!;
  assert.equal(choices.length, 2);
  assert.ok(choices[0].includes('checked=""'));
  assert.ok(!choices[1].includes('checked=""'));
  assert.ok(html.includes('金额单位：百万美元；比例为占经营现金流的比例。'));
  assert.ok(!html.includes('本财年资金来源'));
  o.reconciliation.fx = null;
  const missing = renderToStaticMarkup(
    createElement(CapitalAllocationOverview, { rows: [row(o)] }),
  );
  assert.ok(missing.includes('核心支出数据不完整'));
  assert.ok(missing.includes('资本支出'));
  assert.ok(!missing.includes('本财年资金来源'));
  const empty = renderToStaticMarkup(
    createElement(CapitalAllocationOverview, { rows: [] }),
  );
  assert.ok(!empty.includes('NaN'));
});
test('official Sankey configuration carries three-layer IDs, raw link magnitudes, label spacing and node/link tooltips', () => {
  const m = capitalSankey(fixture()),
    c = capitalSankeyConfig(m, '2025-01-01 → 2025-12-31');
  assert.equal(c.height, capitalSankeyHeight(m));
  assert.ok(c.data);
  assert.ok('layout' in c && c.layout);
  assert.ok(c.tooltip);
  assert.ok('animate' in c && c.animate === false);
});
test('source and use percentages share the actual funds total, retaining OCF ratios only as tooltip context', () => {
  const model = capitalSankey(fixture());
  const before = JSON.stringify(model);
  for (const layer of [0, 2]) {
    const totalRatio = model.nodes
      .filter((n) => n.layer === layer)
      .reduce(
        (sum, n) => sum + capitalFundsRatio(n.amount, model.sourceTotal)!,
        0,
      );
    assert.ok(Math.abs(totalRatio - 100) < 1e-10);
  }
  const c = capitalSankeyConfig(model, '2025');
  const tooltip = c.tooltip as {
    nodeItems: Array<(d: unknown) => { name: string; value: string }>;
  };
  const values = tooltip.nodeItems.map((item) => item({ key: 'capex' }));
  assert.deepEqual(
    values.find((v) => v.name === '占总资金'),
    { name: '占总资金', value: '80.00%' },
  );
  assert.deepEqual(
    values.find((v) => v.name === '占经营现金流'),
    { name: '占经营现金流', value: '120.00%' },
  );
  assert.equal(capitalFundsRatio(164713e6, 314092e6)?.toFixed(2), '52.44');
  assert.equal(capitalFundsRatio(91447e6, 314092e6)?.toFixed(2), '29.11');
  assert.equal(capitalFundsRatio(0, 150e6), 0);
  for (const total of [null, 0, -1, NaN, Infinity])
    assert.equal(capitalFundsRatio(10, total), null);
  const partial = {
    ...model,
    canChart: false,
    status: 'INCOMPLETE' as const,
    nodes: model.nodes.map((n) =>
      n.key === 'capex' ? { ...n, amount: 60e6 } : n,
    ),
  };
  const partialConfig = capitalSankeyConfig(partial, '2025');
  assert.ok('nodeLabels' in partialConfig);
  const labels = partialConfig.nodeLabels as Array<{
    text: (n: (typeof model.nodes)[number]) => string;
  }>;
  assert.equal(
    labels[0].text(partial.nodes.find((n) => n.key === 'capex')!),
    '60 · 40.00%',
  );
  assert.equal(partial.canChart, false);
  assert.equal(partial.status, 'INCOMPLETE');
  assert.equal(JSON.stringify(model), before);
});
test('presentation fixes source/use order, semantic node/link colors and compact two-part labels without changing model values', () => {
  const m = capitalSankey(fixture()),
    seed = m.nodes[0];
  const nodes = (keys: string[], layer: 0 | 2) =>
    keys.map((key, i) => ({ ...seed, key, layer, amount: (i + 1) * 1e6 }));
  const left = nodes(
    [
      'fx',
      'cash',
      'otherFinance',
      'assetDisposals',
      'investSell',
      'stockIssued',
      'debtIn',
      'ocf',
    ],
    0,
  );
  assert.deepEqual(
    [...left].sort(capitalNodeOrder).map((n) => n.key),
    [
      'ocf',
      'debtIn',
      'stockIssued',
      'investSell',
      'assetDisposals',
      'otherFinance',
      'cash',
      'fx',
    ],
  );
  const right = nodes(
    [
      'cash',
      'otherFinance',
      'otherInvest',
      'investBuy',
      'debtOut',
      'dividendsPaid',
      'stockRepurchases',
      'acquisitions',
      'capex',
    ],
    2,
  );
  assert.deepEqual(
    [...right].sort(capitalNodeOrder).map((n) => n.key),
    [
      'capex',
      'acquisitions',
      'stockRepurchases',
      'dividendsPaid',
      'debtOut',
      'investBuy',
      'otherInvest',
      'otherFinance',
      'cash',
    ],
  );
  const node = (key: string) => ({ ...seed, key });
  assert.equal(capitalNodeColor(node('ocf')), capitalNodeColor(node('capex')));
  assert.equal(
    capitalNodeColor(node('acquisitions')),
    capitalNodeColor(node('capex')),
  );
  assert.equal(
    capitalNodeColor(node('stockRepurchases')),
    capitalNodeColor(node('dividendsPaid')),
  );
  assert.equal(
    capitalNodeColor(node('debtIn')),
    capitalNodeColor(node('debtOut')),
  );
  assert.equal(
    capitalNodeColor(node('cash')),
    capitalNodeColor(node('investBuy')),
  );
  assert.equal(
    capitalNodeColor(node('fx')),
    capitalNodeColor(node('otherInvest')),
  );
  assert.equal(
    new Set(
      ['ocf', 'stockRepurchases', 'debtIn', 'cash', 'fx'].map((k) =>
        capitalNodeColor(node(k)),
      ),
    ).size,
    5,
  );
  assert.equal(
    capitalNodeLabel(
      m.nodes.find((n) => n.key === 'pool')!,
      m.sourceTotal,
    ),
    '资金汇总\n150',
  );
  assert.equal(
    capitalNodeLabel(
      {
        ...seed,
        key: 'acquisitions',
        name: '收购及相关投资（混合净额）',
        amount: 91447e6,
        ratio: 55.52,
      },
      314092e6,
    ),
    '收购及相关投资\n91,447 · 29.11%',
  );
  const before = JSON.stringify(m),
    c = capitalSankeyConfig(m, '2025');
  const style = c.style as Record<string, unknown>;
  const linkFill = style.linkFill as (d: { flowKey: string }) => string;
  assert.equal(
    linkFill({ flowKey: 'capex' }),
    capitalNodeColor(m.nodes.find((n) => n.key === 'capex')!),
  );
  assert.equal(style.labelFontWeight, 600);
  assert.ok(
    'nodeLabels' in c &&
      Array.isArray(c.nodeLabels) &&
      c.nodeLabels.length === 1,
  );
  assert.equal(JSON.stringify(m), before);
});

test('official Sankey layout retains endpoint colors, source order and tooltip provenance', () => {
  const require = createRequire(import.meta.url);
  const { Sankey } = require('@antv/g2/lib/mark/sankey');
  const model = capitalSankey(fixture())!;
  const marks = Sankey(capitalSankeyConfig(model, '2025'));
  const nodes = marks[0].data as Array<{ key: string; y: number[] }>;
  const sourceKeys = new Set(
    model.nodes.filter((n) => n.layer === 0).map((n) => n.key),
  );
  assert.equal(
    nodes
      .filter((n) => sourceKeys.has(n.key))
      .sort((a, b) => a.y[0] - b.y[0])[0].key,
    'ocf',
  );
  for (const link of marks[1].data) {
    assert.equal(link.flowKey, undefined);
    const key = link.source.key === 'pool' ? link.target.key : link.source.key;
    const original = model.nodes.find((n) => n.key === key)!;
    assert.equal(marks[1].style.fill(link), capitalNodeColor(original));
    assert.equal(marks[1].tooltip.title(link), original.name);
  }
  assert.ok(new Set(marks[1].data.map(marks[1].style.fill)).size >= 4);
  for (const node of marks[0].data) {
    assert.ok(!marks[0].labels[1].text(node).includes('NaN'));
  }
});
