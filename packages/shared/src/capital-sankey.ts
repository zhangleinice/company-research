import type {
  CapitalAllocationOverview,
  CapitalOverviewItem,
} from './capital-allocation-overview.js';
import type { AllocationSource } from './index.js';
export interface CapitalSankeyNode {
  key: string;
  name: string;
  amount: number;
  reportedAmount?: number;
  ratio: number | null;
  layer: 0 | 1 | 2;
  note: string;
  sources: AllocationSource[];
  components: Array<{ name: string; amount: number; note: string }>;
  unidentified?: boolean;
}
export interface CapitalSankeyLink {
  source: string;
  target: string;
  value: number;
  flowKey: string;
}
export interface CapitalSankeyModel {
  nodes: CapitalSankeyNode[];
  links: CapitalSankeyLink[];
  canChart: boolean;
  status: 'BALANCED' | 'UNIDENTIFIED' | 'INCOMPLETE';
  reason: string | null;
  missing: string[];
  zero: string[];
  sourceTotal: number | null;
  useTotal: number | null;
  identifiedDifference: number | null;
  cashChange: number | null;
  fx: number | null;
}
const names: Record<string, string> = {
  operatingCashFlow: '经营现金流',
  capex: '资本支出',
  acquisitions: '收购及相关投资（混合净额）',
  stockRepurchases: '股票回购',
  dividendsPaid: '股息分红',
  debtIn: '债务融资（披露口径）',
  debtOut: '偿还债务（披露口径）',
  shortDebtNet: '短期债务净变动',
  stockIssued: '股票发行',
  investBuy: '金融资产投资',
  investSell: '金融资产出售及到期回收',
  assetDisposals: '业务、投资及资产出售',
  otherInvest: '其他投资现金流（净额）',
  otherFinance: '其他融资现金流（净额）',
  fx: '汇率折算影响',
  cashChange: '现金余额变化',
};
export const capitalFlowName = (key: string) => names[key] ?? '其他现金流';
const valid = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
/** Accounting bridge, not tracing specific financing to specific purchases. Never mutates SEC inputs. */
export function capitalSankey(
  overview: CapitalAllocationOverview | null | undefined,
): CapitalSankeyModel {
  const o = overview,
    r = o?.reconciliation;
  const result: CapitalSankeyModel = {
    nodes: [],
    links: [],
    canChart: false,
    status: 'INCOMPLETE',
    reason: null,
    missing: [],
    zero: [],
    sourceTotal: null,
    useTotal: null,
    identifiedDifference: null,
    cashChange: r?.cashChange ?? null,
    fx: r?.fx ?? null,
  };
  if (!o || !r) {
    result.reason = '当前缓存缺少资本配置数据。';
    return result;
  }
  const byKey = new Map<string, CapitalOverviewItem>();
  for (const item of o.items) {
    if (byKey.has(item.key)) {
      result.reason = '现金流项目重复，暂不能可靠生成桑基图。';
      return result;
    }
    byKey.set(item.key, item);
    if (!valid(item.value) || item.direction === 'unknown')
      result.missing.push(capitalFlowName(item.key));
    else if (item.value === 0) result.zero.push(capitalFlowName(item.key));
  }
  if (
    !valid(o.ocf) ||
    !valid(r.operating) ||
    r.operating !== o.ocf ||
    !valid(r.investing) ||
    !valid(r.financing) ||
    !valid(r.fx) ||
    !valid(r.cashChange) ||
    r.status !== 'MATCHED' ||
    Math.abs(r.operating + r.investing + r.financing + r.fx - r.cashChange) >
      0.0001
  ) {
    result.reason =
      '主表数据不完整或存在冲突，无法可靠形成平衡图；缺失项目不补零。';
    return result;
  }
  const required = ['capex', 'stockRepurchases', 'dividendsPaid'];
  if (
    required.some(
      (k) =>
        !valid(byKey.get(k)?.value) || byKey.get(k)?.direction === 'unknown',
    )
  ) {
    result.reason = '核心用途数据缺失，暂不能可靠形成平衡图。';
    return result;
  }
  const ratio = (amount: number) =>
    o.ocf !== null && o.ocf > 0 ? (amount / o.ocf) * 100 : null;
  const add = (
    key: string,
    name: string,
    cashImpact: number,
    note: string,
    sources: AllocationSource[],
    components: CapitalSankeyNode['components'],
    unidentified = false,
    reportedAmount = components.length === 1
      ? components[0].amount
      : cashImpact,
  ) => {
    if (!valid(cashImpact) || cashImpact === 0) return;
    const amount = Math.abs(cashImpact);
    result.nodes.push({
      key,
      name,
      amount,
      reportedAmount,
      ratio: ratio(amount),
      layer: cashImpact > 0 ? 0 : 2,
      note,
      sources,
      components,
      unidentified,
    });
  };
  const impacts = new Map<string, number>();
  for (const [key, item] of byKey) {
    if (
      ['operatingCashFlow', 'fx', 'cashChange'].includes(key) ||
      !valid(item.value) ||
      item.direction === 'unknown'
    )
      continue;
    const impact =
      item.direction === 'inflow'
        ? Math.abs(item.value)
        : item.direction === 'outflow'
          ? -Math.abs(item.value)
          : item.value;
    impacts.set(key, impact);
    add(key, capitalFlowName(key), impact, item.note, item.sources, [
      { name: capitalFlowName(key), amount: item.value, note: item.note },
    ]);
  }
  add(
    'ocf',
    '经营现金流',
    o.ocf,
    '经营活动净现金流；负值作为经营现金净消耗，不当作资金来源。',
    byKey.get('operatingCashFlow')?.sources ?? [],
    [],
  );
  const investment = [
    'capex',
    'acquisitions',
    'investBuy',
    'investSell',
    'assetDisposals',
    'otherInvest',
  ];
  const financing = [
    'stockRepurchases',
    'dividendsPaid',
    'debtIn',
    'debtOut',
    'shortDebtNet',
    'stockIssued',
    'otherFinance',
  ];
  // Each unidentified amount is a signed residual against its own disclosed subtotal,
  // never an invented asset, retained cash or a claim that missing components are zero.
  for (const [group, keys, total] of [
    ['投资', investment, r.investing],
    ['融资', financing, r.financing],
  ] as const) {
    const subtotal = keys.reduce((s, k) => s + (impacts.get(k) ?? 0), 0),
      residual = total - subtotal;
    if (Math.abs(residual) > 0.0001)
      add(
        'unidentified' + group,
        `未识别${group}现金流差额`,
        residual,
        `${group}现金流主表净额 ${total} − 已识别项目现金影响 ${subtotal} = ${residual} 美元。仅为未解释净差额，不认定其具体用途；缺失分项仍为缺失。`,
        r.sources,
        [],
        true,
      );
  }
  add(
    'fx',
    '汇率折算影响（非经营资金）',
    r.fx,
    '单独列示现金折算影响，不视为经营收入或实际融资现金。',
    byKey.get('fx')?.sources ?? r.sources,
    [],
  );
  add(
    'cash',
    r.cashChange < 0 ? '动用原有现金' : '现金储备增加',
    -r.cashChange,
    '仅据现金流量表现金余额变动确认，可能包含受限现金及处置组现金；不代表全部可以自由使用。不以现金流差额推算。',
    byKey.get('cashChange')?.sources ?? r.sources,
    [],
    false,
    r.cashChange,
  );
  const sources = result.nodes.filter((n) => n.layer === 0),
    uses = result.nodes.filter((n) => n.layer === 2);
  result.sourceTotal = sources.reduce((s, n) => s + n.amount, 0);
  result.useTotal = uses.reduce((s, n) => s + n.amount, 0);
  result.identifiedDifference = result.sourceTotal - result.useTotal;
  if (
    !sources.length ||
    !uses.length ||
    !valid(result.sourceTotal) ||
    Math.abs(result.identifiedDifference) > 0.0001
  ) {
    result.nodes = [];
    result.reason =
      '已识别现金流无法形成可靠平衡，保留明细，不添加平衡用现金储备。';
    return result;
  }
  const hub: CapitalSankeyNode = {
    key: 'pool',
    name: '资金汇总',
    amount: result.sourceTotal,
    ratio: ratio(result.sourceTotal),
    layer: 1,
    note: '仅展示本期现金收支汇总关系，不暗示任何一笔融资定向用于某项支出；包含净额披露及单独的汇率影响。',
    sources: r.sources,
    components: [],
  };
  result.nodes = [...sources, hub, ...uses];
  result.links = result.nodes
    .filter((n) => n.layer !== 1)
    .map((n) => ({
      source: n.layer === 0 ? n.key : 'pool',
      target: n.layer === 0 ? 'pool' : n.key,
      value: n.amount / 1e6,
      flowKey: n.key,
    }));
  result.canChart = true;
  result.status = result.nodes.some((n) => n.unidentified)
    ? 'UNIDENTIFIED'
    : 'BALANCED';
  return result;
}
