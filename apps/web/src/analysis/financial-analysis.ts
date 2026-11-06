import type {
  CompanyDetail,
  FinancialMetric,
  FinancialMode,
  FinancialPeriod,
} from '@company-research/shared';

export type MetricUnit = 'money' | 'percent' | 'perShare' | 'ratio';
export interface MetricDefinition {
  key: FinancialMetric;
  label: string;
  description: string;
  unit: MetricUnit;
}
const metric = (
  key: FinancialMetric,
  label: string,
  description: string,
  unit: MetricUnit = 'money',
): MetricDefinition => ({ key, label, description, unit });
export const METRICS = {
  revenue: metric('revenue', 'Revenue', '营业收入：本报告期间确认的收入。'),
  revenueGrowth: metric(
    'revenueGrowth',
    'Revenue YoY',
    '营收同比 =（本期营收 ÷ 可比上期营收 − 1）× 100%；季度与去年同季度比较。',
    'percent',
  ),
  eps: metric(
    'eps',
    'Diluted EPS',
    '稀释每股收益：使用 SEC 披露的对应期间每股收益；不对累计 EPS 做差分。',
    'perShare',
  ),
  epsGrowth: metric(
    'epsGrowth',
    'EPS YoY',
    '稀释 EPS 同比；基期须大于零且口径可比，否则不计算。',
    'percent',
  ),
  revenueCagr3y: metric(
    'revenueCagr3y',
    'Revenue CAGR · 3Y',
    '营收三年复合增长率 =（本期 ÷ 三年前同期）^(1/3) − 1；需完整、正值且可比的年度数据。',
    'percent',
  ),
  revenueCagr5y: metric(
    'revenueCagr5y',
    'Revenue CAGR · 5Y',
    '营收五年复合增长率 =（本期 ÷ 五年前同期）^(1/5) − 1；历史不足时不计算。',
    'percent',
  ),
  epsCagr3y: metric(
    'epsCagr3y',
    'EPS CAGR · 3Y',
    '稀释 EPS 三年复合增长率；仅采用正值且可比的年度数据，零值、负值或历史不足时不计算。',
    'percent',
  ),
  epsCagr5y: metric(
    'epsCagr5y',
    'EPS CAGR · 5Y',
    '稀释 EPS 五年复合增长率；季度不使用年度 CAGR 代替。',
    'percent',
  ),
  grossProfit: metric(
    'grossProfit',
    'Gross Profit',
    '毛利润：对应报告期间收入扣除营业成本后的披露值。',
  ),
  operatingIncome: metric(
    'operatingIncome',
    'Operating Income',
    '营业利润：对应报告期间的经营利润或亏损。',
  ),
  netIncome: metric(
    'netIncome',
    'Net Income',
    '净利润：对应报告期间的净收益或亏损。',
  ),
  grossMargin: metric(
    'grossMargin',
    'Gross Margin',
    '毛利率 = 毛利润 ÷ 营业收入 × 100%；收入需大于零。',
    'percent',
  ),
  operatingMargin: metric(
    'operatingMargin',
    'Operating Margin',
    '营业利润率 = 营业利润 ÷ 营业收入 × 100%。',
    'percent',
  ),
  netMargin: metric(
    'netMargin',
    'Net Margin',
    '净利率 = 净利润 ÷ 营业收入 × 100%。',
    'percent',
  ),
  roe: metric(
    'roe',
    'ROE',
    '年度净资产收益率 = 年度净利润 ÷ 期初与期末股东权益的平均值 × 100%；缺少期初值不计算。',
    'percent',
  ),
  roa: metric(
    'roa',
    'ROA',
    '年度资产收益率 = 年度净利润 ÷ 期初与期末总资产的平均值 × 100%；缺少期初值不计算。',
    'percent',
  ),
  operatingCashFlow: metric(
    'operatingCashFlow',
    'OCF',
    '经营活动现金净额：年度为全年，季度为独立季度；累计值由后端按可比期间差分。',
  ),
  capex: metric(
    'capex',
    'CapEx',
    '资本支出：目前采用购建物业、厂房及设备的现金支出；不将并购、净投资现金流或缺失字段当作资本支出。',
  ),
  fcf: metric(
    'fcf',
    'FCF',
    '自由现金流 = OCF − CapEx；任一输入缺失时不计算。此口径不包含并购或无形资产购置。',
  ),
  fcfGrowth: metric(
    'fcfGrowth',
    'FCF YoY',
    '自由现金流同比；与上一年可比期间比较，基期须大于零。',
    'percent',
  ),
  fcfMargin: metric(
    'fcfMargin',
    'FCF Margin',
    '自由现金流率 = FCF ÷ 营业收入 × 100%。',
    'percent',
  ),
  stockRepurchases: metric(
    'stockRepurchases',
    'Stock Repurchases',
    '本报告期间实际回购普通股的现金支出，不代表回购授权额度。',
  ),
  dividendsPaid: metric(
    'dividendsPaid',
    'Dividends Paid',
    '本报告期间实际支付的现金分红。',
  ),
  cash: metric(
    'cash',
    'Cash',
    '对应报告期末的现金及现金等价物，不包含可交易证券或其他短期投资。',
  ),
  marketableSecurities: metric(
    'marketableSecurities',
    'Marketable Securities',
    '后端可靠映射的流动可交易证券或短期投资；未披露或未映射时保留缺失。',
  ),
  totalDebt: metric(
    'totalDebt',
    'Total Debt',
    '对应期末的有息债务：可靠的短期债务 + 长期债务；不是总负债，不将缺失组成当零。',
  ),
  netDebt: metric(
    'netDebt',
    'Net Debt（仅扣现金）',
    '净债务 = Total Debt − Cash；这里只扣除现金及现金等价物，不扣除可交易证券或短期投资，可为负值。',
  ),
  currentAssets: metric(
    'currentAssets',
    'Current Assets',
    '报告期末流动资产余额。',
  ),
  currentLiabilities: metric(
    'currentLiabilities',
    'Current Liabilities',
    '报告期末流动负债余额。',
  ),
  currentRatio: metric(
    'currentRatio',
    'Current Ratio',
    '流动比率 = 流动资产 ÷ 流动负债；分母需大于零。',
    'ratio',
  ),
  debtToEquity: metric(
    'debtToEquity',
    'Debt / Equity',
    '债务权益比 = 有息总债务 ÷ 股东权益；权益需大于零。',
    'ratio',
  ),
} satisfies Partial<Record<FinancialMetric, MetricDefinition>>;

export const ANALYSIS_MODULES = [
  {
    key: 'growth',
    title: '增长分析 · Growth',
    purpose: '观察收入与每股收益是否持续增长，以及增长速度是否稳定。',
  },
  {
    key: 'profitability',
    title: '盈利能力 · Profitability',
    purpose: '结合利润率与资本回报，观察公司盈利能力的强弱和持续性。',
  },
  {
    key: 'cash-flow',
    title: '现金流分析 · Cash Flow',
    purpose: '观察利润能否转化为经营现金，以及资本开支如何影响自由现金流。',
  },
  {
    key: 'financial-health',
    title: '财务健康 · Financial Health',
    purpose: '对比现金储备、债务规模与流动性，了解公司的偿债能力。',
  },
] as const;

export function analysisPeriods(
  detail: Pick<CompanyDetail, 'annual' | 'quarterly'>,
  mode: FinancialMode,
): FinancialPeriod[] {
  return [...(mode === 'annual' ? detail.annual : detail.quarterly)]
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .slice(0, 10);
}
export function analysisValue(
  row: FinancialPeriod | undefined,
  key: FinancialMetric,
  mode: FinancialMode,
): number | null {
  if (
    mode === 'quarterly' &&
    (key === 'roe' || key === 'roa' || key.includes('Cagr'))
  )
    return null;
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function formatAnalysisValue(
  value: number | null,
  unit: MetricUnit,
): string {
  if (value === null) return '—';
  const number = value / (unit === 'money' ? 1000000 : 1);
  const text = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: unit === 'percent' ? 2 : 0,
  }).format(number);
  return unit === 'percent'
    ? `${text}%`
    : unit === 'ratio'
      ? `${text} 倍`
      : text;
}
