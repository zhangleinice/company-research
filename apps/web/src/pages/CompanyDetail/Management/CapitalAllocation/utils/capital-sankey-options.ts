import type { SankeyConfig } from '@ant-design/charts';
import type {
  CapitalSankeyModel,
  CapitalSankeyNode,
} from '@company-research/shared';
type LayoutNode = CapitalSankeyNode & { x?: number[] };
export const capitalNodeAmount = (value: number) =>
  value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const amount = (value: number) =>
  value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function capitalNodeName(n: CapitalSankeyNode): string {
  const names: Record<string, string> = {
    ocf: n.layer === 0 ? '经营现金流' : '经营现金净消耗',
    debtIn: '债务融资',
    stockIssued: '股票发行',
    investSell: '金融资产回收',
    assetDisposals: '资产出售',
    capex: '资本支出',
    acquisitions: '收购及相关投资',
    stockRepurchases: '股票回购',
    dividendsPaid: '股息分红',
    debtOut: '偿还债务',
    investBuy: '金融资产投资',
    otherInvest: n.layer === 0 ? '其他投资净流入' : '其他投资净支出',
    otherFinance: n.layer === 0 ? '其他融资净流入' : '其他融资净支出',
    shortDebtNet: n.layer === 0 ? '短期债务净融资' : '短期债务净偿还',
    cash: n.layer === 0 ? '动用原有现金' : '现金储备增加',
    fx: '汇率影响',
    pool: '资金汇总',
  };
  return names[n.key] ?? n.name;
}
const rank = (n: CapitalSankeyNode) => {
  const ranks: Record<string, number> =
    n.layer === 0
      ? {
          ocf: 0,
          debtIn: 1,
          shortDebtNet: 1.5,
          stockIssued: 2,
          investSell: 3,
          assetDisposals: 4,
          otherInvest: 5,
          otherFinance: 5.5,
          cash: 7,
          fx: 8,
        }
      : {
          ocf: -1,
          capex: 0,
          acquisitions: 1,
          stockRepurchases: 2,
          dividendsPaid: 3,
          debtOut: 4,
          shortDebtNet: 4.5,
          investBuy: 5,
          otherInvest: 6,
          otherFinance: 7,
          cash: 9,
          fx: 10,
        };
  return ranks[n.key] ?? (n.layer === 0 ? 6 : 8);
};
export const capitalNodeOrder = (a: CapitalSankeyNode, b: CapitalSankeyNode) =>
  a.layer - b.layer || rank(a) - rank(b) || a.key.localeCompare(b.key);
export function capitalNodeColor(node: Pick<CapitalSankeyNode, 'key'>): string {
  if (['ocf', 'capex', 'acquisitions'].includes(node.key)) return '#628fb2';
  if (['stockRepurchases', 'dividendsPaid'].includes(node.key))
    return '#7c9f87';
  if (['debtIn', 'debtOut', 'shortDebtNet'].includes(node.key))
    return '#be946a';
  if (
    [
      'stockIssued',
      'investBuy',
      'investSell',
      'assetDisposals',
      'cash',
    ].includes(node.key)
  )
    return '#859baa';
  return '#9b9fa6';
}
export const capitalFundsRatio = (value: number, total: number | null) =>
  Number.isFinite(value) &&
  total !== null &&
  Number.isFinite(total) &&
  total > 0
    ? (value / total) * 100
    : null;
export const capitalNodeValue = (
  n: CapitalSankeyNode,
  total: number | null,
) => {
  const ratio = capitalFundsRatio(n.amount, total);
  return (
    capitalNodeAmount(n.amount / 1e6) +
    (n.layer === 1 ? '' : ` · ${ratio === null ? '—' : amount(ratio) + '%'}`)
  );
};
export const capitalNodeLabel = (n: CapitalSankeyNode, total: number | null) =>
  `${capitalNodeName(n)}\n${capitalNodeValue(n, total)}`;
export function capitalSankeyHeight(model: CapitalSankeyModel): number {
  const count = Math.max(
    model.nodes.filter((n) => n.layer === 0).length,
    model.nodes.filter((n) => n.layer === 2).length,
  );
  return Math.max(480, count * 60 + 56);
}
export function capitalSankeyConfig(
  model: CapitalSankeyModel,
  period: string,
): SankeyConfig {
  const info = (datum: unknown): CapitalSankeyNode | undefined => {
    const d = datum as {
      key?: string;
      flowKey?: string;
      source?: string | { key: string };
      target?: string | { key: string };
    };
    // G2 rebuilds links during layout and retains only their endpoints/value.
    const endpoint = (n: typeof d.source) =>
      typeof n === 'string' ? n : n?.key;
    const source = endpoint(d.source);
    const key =
      d.flowKey ?? d.key ?? (source === 'pool' ? endpoint(d.target) : source);
    return model.nodes.find((n) => n.key === key);
  };
  const items = [
    (d: unknown) => ({
      name:
        info(d)?.layer === 1
          ? '汇总金额（美元）'
          : info(d)?.unidentified
            ? '计算差额（美元）'
            : '原始金额（美元）',
      value:
        (info(d)?.reportedAmount ?? info(d)?.amount)?.toLocaleString('zh-CN', {
          maximumFractionDigits: 8,
        }) ?? '—',
    }),
    (d: unknown) => {
      const node = info(d);
      const ratio = node
        ? capitalFundsRatio(node.amount, model.sourceTotal)
        : null;
      return {
        name: '占总资金',
        value: ratio === null ? '—' : amount(ratio) + '%',
      };
    },
    (d: unknown) => ({
      name: '占经营现金流',
      value: info(d)?.ratio == null ? '—' : amount(info(d)!.ratio!) + '%',
    }),
    () => ({ name: '报告期间', value: period }),
    (d: unknown) => ({
      name: '计算依据与口径',
      value: info(d)?.note ?? '来源经资金汇总连接用途，不代表定向融资。',
    }),
    (d: unknown) => ({
      name: '详细组成',
      value:
        info(d)
          ?.components.map(
            (x) =>
              `${x.name}：${x.amount.toLocaleString('zh-CN')} 美元；${x.note}`,
          )
          .join('；') || '主表现金流汇总／现金余额变动',
    }),
    (d: unknown) => ({
      name: '财报来源',
      value:
        info(d)
          ?.sources.map(
            (s) =>
              `${s.concept}；${s.start ?? ''}至${s.end}；${s.accessionNumber}；${s.url}`,
          )
          .join('\n') || '来源缺失，不认定为零',
    }),
  ];
  const count = Math.max(
    model.nodes.filter((n) => n.layer === 0).length,
    model.nodes.filter((n) => n.layer === 2).length,
  );
  return {
    data: {
      nodes: [...model.nodes].sort(capitalNodeOrder).map((n) => ({ ...n })),
      links: model.links.map((l) => ({ ...l })),
    },
    height: capitalSankeyHeight(model),
    autoFit: true,
    animate: false,
    padding: 24,
    layout: {
      nodeId: (d: CapitalSankeyNode) => d.key,
      nodeAlign: (d: CapitalSankeyNode) => d.layer,
      nodeSort: capitalNodeOrder,
      nodeWidth: 0.014,
      nodePadding: Math.min(0.08, 0.65 / Math.max(1, count - 1)),
      iterations: 20,
    },
    style: {
      labelText: (d: CapitalSankeyNode) => capitalNodeName(d),
      labelFontSize: 12,
      labelFontWeight: 600,
      labelFill: '#303841',
      labelDy: -10,
      labelSpacing: 8,
      nodeFill: (d: CapitalSankeyNode) => capitalNodeColor(d),
      nodeStroke: '#ffffff',
      nodeLineWidth: 1,
      linkFill: (d: unknown) => {
        const n = info(d);
        return n ? capitalNodeColor(n) : '#9b9fa6';
      },
      linkFillOpacity: 0.38,
    },
    nodeLabels: [
      {
        text: (d: CapitalSankeyNode) => capitalNodeValue(d, model.sourceTotal),
        position: (d: LayoutNode) => ((d.x?.[0] ?? 0) < 0.5 ? 'right' : 'left'),
        dx: (d: LayoutNode) => ((d.x?.[0] ?? 0) < 0.5 ? 8 : -8),
        textAlign: (d: LayoutNode) => ((d.x?.[0] ?? 0) < 0.5 ? 'start' : 'end'),
        dy: 10,
        fontSize: 11,
        fontWeight: 400,
        fill: '#59636e',
      },
    ],
    tooltip: {
      nodeTitle: (d: unknown) => info(d)?.name ?? '资金汇总',
      nodeItems: items,
      linkTitle: (d: unknown) => info(d)?.name ?? '资金流',
      linkItems: items,
    },
  };
}
