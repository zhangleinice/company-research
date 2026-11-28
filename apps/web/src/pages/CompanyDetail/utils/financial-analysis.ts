import type {
  CompanyDetail,
  FinancialMetric,
  FinancialMode,
  FinancialPeriod,
} from '@company-research/shared';

type DisplayMetric =
  | FinancialMetric
  | 'capexToOcf'
  | 'cashConversionRatio'
  | 'interestCoverage'
  | 'cashAndShortTermSecurities'
  | 'netDebtAfterLiquidAssets';
export type MetricUnit =
  'money' | 'percent' | 'perShare' | 'ratio' | 'shares' | 'multiple';
export interface MetricDefinition {
  key: DisplayMetric;
  label: string;
  description: string;
  unit: MetricUnit;
}
const metric = (
  key: DisplayMetric,
  label: string,
  description: string,
  unit: MetricUnit = 'money',
): MetricDefinition => ({ key, label, description, unit });
export const METRICS = {
  dividendsPerShare: metric(
    'dividendsPerShare',
    'Dividends Per Share (DPS)',
    '普通股已宣告每股现金股息，美元/股，与实际支付额 Dividends Paid 不同。季度仅采用当季直接披露值，不用全年或累计数替代。0 表示明确披露的零值，— 表示缺失。',
    'perShare',
  ),
  dpsGrowth: metric(
    'dpsGrowth',
    'DPS YoY',
    '已宣告每股股息同比；季度与去年同季度直接披露值比较。基期为 0 或缺失时不计算。',
    'percent',
  ),
  dilutedShares: metric(
    'dilutedShares',
    'Diluted Shares',
    '计算 EPS 使用的期间稀释加权平均股数，不是期末股数或回购股数。季度只取当季直接披露值；不推算拆股调整，历史趋势可能有口径断点。变化还受股权激励、增发等影响，不能全部归因于回购。',
    'shares',
  ),
  dilutedSharesGrowth: metric(
    'dilutedSharesGrowth',
    'Diluted Shares YoY',
    '与同一申报中披露的去年同期股数比较；仅使用直接披露的同期间、同拆股口径数据。缺失时不计算。',
    'percent',
  ),
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
    '毛利润：优先使用直接披露值；否则由后端使用同申报、同期间和币种的收入减销售成本计算，缺失时不补零。',
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
    'Gross Margin · 毛利率',
    '毛利率 = 毛利润 ÷ 营业收入 × 100%；收入需大于零。',
    'percent',
  ),
  operatingMargin: metric(
    'operatingMargin',
    'Operating Margin · 营业利润率',
    '营业利润率 = 营业利润 ÷ 营业收入 × 100%。',
    'percent',
  ),
  netMargin: metric(
    'netMargin',
    'Net Margin · 净利率',
    '净利率 = 净利润 ÷ 营业收入 × 100%。',
    'percent',
  ),
  roe: metric(
    'roe',
    'ROE · 净资产收益率',
    '年度净利润相对于平均股东权益的回报率；按期初、期末权益的平均值计算。缺失、权益非正或季度口径未验证时显示 —。',
    'percent',
  ),
  roa: metric(
    'roa',
    'ROA',
    '年度资产收益率 = 年度净利润 ÷ 期初与期末总资产的平均值 × 100%；总资产优先匹配同申报的合并净利润，缺少可靠余额时不计算。',
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
  capexToOcf: metric(
    'capexToOcf',
    'CapEx / OCF',
    '经营现金流中有多少比例用于当前定义的资本开支：CapEx ÷ OCF × 100%；OCF 须大于 0。此比例不是越低越好，需要结合企业成长阶段判断。',
    'percent',
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
    'FCF Margin · 自由现金流利润率',
    '衡量营业收入转化为自由现金流的能力。FCF Margin = 同期 FCF ÷ Revenue × 100%；收入须大于零，缺失不补零。允许负值和超过100%的结果，季度使用独立季度，不年化。',
    'percent',
  ),
  cashConversionRatio: metric(
    'cashConversionRatio',
    'Cash Conversion Ratio · 利润现金转化率',
    '衡量账面净利润转化为经营活动现金流的能力。Cash Conversion Ratio = 同期 OCF ÷ Net Income × 100%；净利润须大于零，缺失不补零。允许负现金流和超过100%的结果，季度使用独立季度，不年化。',
    'percent',
  ),
  stockRepurchases: metric(
    'stockRepurchases',
    'Stock Repurchases',
    '当期回购普通股的现金支出，不是回购股数或回购授权额度；不据此估算实际回购股数。',
  ),
  dividendsPaid: metric(
    'dividendsPaid',
    'Dividends Paid',
    '当期实际支付的现金股息，优先采用普通股支付额；缺少该标签时采用总额，可能包括优先股及非控股权益分配。与已宣告的普通股 DPS 口径不同，不能混算。',
  ),
  cash: metric(
    'cash',
    'Cash',
    '对应报告期末的现金及现金等价物；Cash 不等于全部流动性资产，不包含单独列报的短期可交易证券。',
  ),
  marketableSecurities: metric(
    'marketableSecurities',
    'Marketable Securities',
    '资产负债表流动资产项下、与现金分列的可交易证券或短期投资；不代表全部证券均在一年内到期，不含非流动投资。',
  ),
  totalDebt: metric(
    'totalDebt',
    'Total Debt',
    '同期账面有息借款：流动债务（含一年内到期部分）+ 非流动债务；不重复计入商业票据，明确披露的融资租赁剔除。不使用面值或总负债替代，缺失组成不当作零。',
  ),
  netDebt: metric(
    'netDebt',
    'Net Debt · 净债务',
    '总有息债务减去现金及现金等价物，未扣除短期投资或其他金融资产；可为负值。',
  ),
  cashAndShortTermSecurities: metric(
    'cashAndShortTermSecurities',
    'Cash + Marketable Securities',
    '报告期末现金及现金等价物 + 与现金分列的流动可交易证券。仅采用后端已与 SEC 同期披露合计核对一致、确认不重叠的值；不含非流动或不可交易投资。不能核实时显示 —，不在前端自行相加。',
  ),
  netDebtAfterLiquidAssets: metric(
    'netDebtAfterLiquidAssets',
    'Net Debt after Liquid Assets',
    '调整后净债务 = Total Debt −（Cash + 经核验的流动可交易证券）；只扣上述资产，不扣长期或不可交易投资，可为负值。',
  ),
  interestCoverage: metric(
    'interestCoverage',
    'Interest Coverage · 利息保障倍数',
    '报表参考口径：Operating Income ÷ Interest Expense，营业利润作为EBIT代理；仅使用同期间可靠总利息费用，不用净利息或现金付息。利息须大于零；经营亏损可为负，金融企业不适用。',
    'multiple',
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
} satisfies Partial<Record<DisplayMetric, MetricDefinition>>;

export const ANALYSIS_MODULES = [
  {
    key: 'growth',
    title: '增长分析 · Growth',
  },
  {
    key: 'profitability',
    title: 'Profitability & Capital Returns · 盈利与资本回报',
  },
  {
    key: 'cash-flow',
    title: 'Cash Flow · 现金流',
  },
  {
    key: 'financial-health',
    title: 'Financial Health · 财务健康',
  },
  {
    key: 'shareholder-returns',
    title: 'Shareholder Returns · 股东回报',
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
  key: DisplayMetric,
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
  const number = value / (unit === 'money' || unit === 'shares' ? 1000000 : 1);
  const text = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: unit === 'percent' || unit === 'multiple' ? 2 : 0,
  }).format(number);
  return unit === 'percent'
    ? `${text}%`
    : unit === 'multiple'
      ? `${text}x`
      : unit === 'ratio'
        ? `${text} 倍`
        : text;
}
