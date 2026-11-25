import { historicalFcff, type ValuationFact } from './dcf.js';
export const SIMPLE_DEFAULT_POLICY = 'simple-valuation-defaults-v2';
export const FEDERAL_TAX_SOURCE = 'https://www.irs.gov/instructions/i1120';
export const INFLATION_SOURCE =
  'https://www.federalreserve.gov/faqs/economy_14400.htm';
export interface SimpleFcffPeriod {
  start: string | null;
  end: string;
  label: string;
  ocf: ValuationFact;
  capex: ValuationFact;
  interest: ValuationFact;
  revenue: ValuationFact;
  tax: ValuationFact;
  pretax: ValuationFact;
  taxSourceValid: boolean;
  approximationAllowed: boolean;
  reason: string | null;
  warnings: string[];
}
export interface SimpleAnnualObservation {
  year: number | null;
  start: string;
  end: string;
  revenue: number | null;
  fcf: number | null;
  capex: number | null;
  sources: Record<string, unknown>;
  storedCagrPercent?: {
    fcf: { 3: number | null; 5: number | null };
    revenue: { 3: number | null; 5: number | null };
  };
}
export interface SimpleValuationData {
  version: 1;
  currency: 'USD' | null;
  cik: string;
  sic: string | null;
  usIncorporated: boolean | null;
  incorporation: string | null;
  profileSource: string;
  ttm: SimpleFcffPeriod;
  latestAnnual: SimpleFcffPeriod | null;
  annual: SimpleAnnualObservation[];
}
export type TaxMethod = 'federal' | 'effective' | 'manual';
export type FcffMethod = 'ttm' | 'annual' | 'manual';
export type GrowthMethod = 'fcf' | 'revenue';
export interface SimpleEstimate {
  value: number | null;
  reason: string | null;
  formula: string;
  warnings: string[];
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const result = (
  value: number | null,
  formula: string,
  reason: string | null = null,
  warnings: string[] = [],
): SimpleEstimate => ({ value, formula, reason, warnings });
export function effectiveTaxRate(p: SimpleFcffPeriod): SimpleEstimate {
  const tax = p.tax,
    pretax = p.pretax;
  const days = tax.start
    ? (Date.parse(tax.end) - Date.parse(tax.start)) / 86400000
    : 0;
  if (
    p.taxSourceValid !== true ||
    !finite(tax.value) ||
    !finite(pretax.value) ||
    pretax.value <= 0 ||
    !tax.start ||
    !Number.isFinite(days) ||
    days < 350 ||
    days > 380 ||
    (p.start !== null && tax.start !== p.start) ||
    !tax.items.every((x) => x.unit === 'USD') ||
    !pretax.items.every((x) => x.unit === 'USD') ||
    tax.start !== pretax.start ||
    tax.end !== pretax.end ||
    tax.end !== p.end ||
    !tax.items.length ||
    !pretax.items.length
  )
    return result(
      null,
      'TTM Income Tax Expense / TTM Pretax Income',
      '缺少同期间TTM税费/税前利润，或税前利润非正',
    );
  const value = tax.value / pretax.value;
  return value < 0 || value > 1 || !finite(value)
    ? result(
        null,
        `${tax.value / 1e6} / ${pretax.value / 1e6}`,
        '历史有效税率异常，不截断或自动采用',
      )
    : result(
        value,
        `${tax.value / 1e6} / ${pretax.value / 1e6} = ${value * 100}%`,
        null,
        ['历史有效税率不一定等于利息税盾的边际税率，一次性税项未正常化。'],
      );
}
export function defaultTaxRate(
  data: SimpleValuationData | null,
  method: TaxMethod,
  manual: number | null,
): SimpleEstimate {
  if (method === 'manual')
    return finite(manual) && manual >= 0 && manual <= 1
      ? result(manual, `用户税率 = ${manual * 100}%`)
      : result(null, '用户税率', '请输入0%至100%的有效税率');
  if (method === 'effective')
    return data
      ? effectiveTaxRate(data.ttm)
      : result(null, 'TTM税费 / TTM税前利润', '缺少TTM税务输入');
  return data?.usIncorporated === true
    ? result(0.21, '美国联邦法定税率参考 = 21%', null, [
        '按SEC披露的美国注册地采用联邦税率简化参考，不含州/海外税及抵扣限制，不保证边际税盾。',
      ])
    : result(
        null,
        '美国联邦税率参考',
        '未确认属于适用的美国注册企业，不自动采用21%',
      );
}
export function approximateSimpleFcff(
  period: SimpleFcffPeriod | null,
  tax: number | null,
): SimpleEstimate {
  if (!period || !period.approximationAllowed)
    return result(
      null,
      'OCF − CapEx + Interest × (1 − Tax)',
      period?.reason ?? '缺少对应期间FCFF输入',
    );
  if (!finite(tax) || tax < 0 || tax > 1)
    return result(null, 'OCF − CapEx + Interest × (1 − Tax)', '缺少有效税率');
  const fcf =
    finite(period.ocf.value) && finite(period.capex.value)
      ? period.ocf.value - period.capex.value
      : null;
  const value = historicalFcff(fcf, period.interest.value, tax, {
    interestInOcf: true,
    adjustmentsReviewed: true,
    taxShieldReviewed: true,
  });
  return result(
    value === null ? null : value / 1e6,
    `${period.ocf.value === null ? '—' : period.ocf.value / 1e6} − ${period.capex.value === null ? '—' : period.capex.value / 1e6} + ${period.interest.value === null ? '—' : period.interest.value / 1e6} × (1 − ${tax * 100}%) = ${value === null ? '—' : value / 1e6}`,
    value === null
      ? '同期输入无法核准'
      : value <= 0
        ? 'FCFF非正，当前简单增长模型不适用'
        : null,
    period.warnings,
  );
}
export interface GrowthReference extends SimpleEstimate {
  years: number;
  points: SimpleAnnualObservation[];
  referenceValue: number | null;
}
export function historicalGrowth(
  rows: SimpleAnnualObservation[],
  method: GrowthMethod,
  years = 5,
): GrowthReference {
  const points = [...rows]
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, years + 1)
    .reverse();
  const formula = 'CAGR = (Ending / Beginning)^(1 / ' + years + ') − 1';
  const missing = (reason: string): GrowthReference => ({
    ...result(null, formula, reason),
    years,
    points,
    referenceValue: null,
  });
  if (points.length !== years + 1)
    return missing(`需要${years + 1}个完整年度数据点`);
  if (
    points.some(
      (p, i) =>
        p.year === null ||
        !Number.isFinite(Date.parse(p.start)) ||
        !Number.isFinite(Date.parse(p.end)) ||
        (Date.parse(p.end) - Date.parse(p.start)) / 86400000 < 350 ||
        (Date.parse(p.end) - Date.parse(p.start)) / 86400000 > 380 ||
        !finite(p[method]) ||
        (i > 0 &&
          (p.year !== points[i - 1].year! + 1 ||
            (Date.parse(p.end) - Date.parse(points[i - 1].end)) / 86400000 <
              350 ||
            (Date.parse(p.end) - Date.parse(points[i - 1].end)) / 86400000 >
              380)),
    )
  )
    return missing('历史年度不连续、指标缺失或期间不能核准');
  const start = points[0][method]!,
    end = points[years][method]!;
  if (start <= 0 || end <= 0) return missing('CAGR基期或末期非正，不自动估计');
  const value = (end / start) ** (1 / years) - 1;
  if (!finite(value)) return missing('CAGR计算结果无效');
  const stored = points[years].storedCagrPercent;
  if (stored && (years === 3 || years === 5)) {
    const approved = stored[method][years];
    if (!finite(approved) || Math.abs(approved - value * 100) > 1e-7)
      return missing(
        '已有财务归一化CAGR比较口径未核准，或与当前原始金额不一致',
      );
  }
  const warnings = ['历史增长率不代表未来增长，预测仍需承担相应再投资。'];
  const negative = method === 'fcf' && points.some((p) => p.fcf! <= 0);
  if (negative)
    warnings.push(
      '历史FCF存在非正年度，仅保留数学参考，不自动用作未来增长率。',
    );
  if (
    method === 'fcf' &&
    points.some(
      (p, i) =>
        i > 0 &&
        points[i - 1].fcf! > 0 &&
        Math.abs(p.fcf! / points[i - 1].fcf! - 1) >= 0.5,
    )
  )
    warnings.push(
      '历史FCF存在同比幅度达到50%的波动；该阈值仅作提示，不截断CAGR。',
    );
  if (
    points.some(
      (p, i) =>
        i > 0 &&
        finite(p.capex) &&
        finite(points[i - 1].capex) &&
        points[i - 1].capex! > 0 &&
        Math.abs(p.capex! / points[i - 1].capex! - 1) >= 0.5,
    )
  )
    warnings.push(
      '历史现金CapEx存在同比幅度达到50%的变化，需判断正常投资水平；该阈值不改变增长率。',
    );
  return {
    ...result(
      negative ? null : value,
      `FY${points[0].year} ${start / 1e6} → FY${points[years].year} ${end / 1e6}；(${end / 1e6} / ${start / 1e6})^(1/${years}) − 1 = ${value * 100}%`,
      negative ? '历史现金流不稳定，需手动判断未来增长率' : null,
      warnings,
    ),
    years,
    points,
    referenceValue: value,
  };
}
export interface IndustryWaccData {
  date: string;
  source: string;
  page: string;
  currency: string;
  industries: { name: string; wacc: number }[];
  nonFinancialMarket?: { name: string; wacc: number };
}
/** Research crosswalk, not an official Damodaran/SIC mapping. Ambiguous SICs deliberately omitted. */
export const SIC_WACC_MAP: Record<string, string> = {
  '2086': 'Beverage (Soft)',
  '2082': 'Beverage (Alcoholic)',
  '2085': 'Beverage (Alcoholic)',
  '3571': 'Computers/Peripherals',
  '3572': 'Computers/Peripherals',
  '7372': 'Software (System & Application)',
  '7311': 'Advertising',
  '4512': 'Air Transport',
  '3711': 'Auto & Truck',
  '2834': 'Drugs (Pharmaceutical)',
  '4911': 'Utility (General)',
  '4813': 'Telecom. Services',
  '2911': 'Oil/Gas (Integrated)',
};
/** Explicit approximate classifications; no fuzzy matching or company-specific overrides. */
export const SIC_WACC_APPROXIMATIONS: Record<
  string,
  { industry: string; basis: string }
> = {
  '7370': {
    industry: 'Computer Services',
    basis:
      'SIC 7370涵盖计算机编程及数据处理等综合服务，以Computer Services作大类近似；互联网、广告等业务可能需要主动切换行业。',
  },
};
export function industryWacc(
  data: IndustryWaccData,
  sic: string | null,
  selected?: string | null,
): SimpleEstimate & {
  industry: string | null;
  tier:
    'exact' | 'approximate' | 'nonfinancial-market' | 'manual' | 'unavailable';
  basisReason: string;
} {
  const usable = (x: { name: string; wacc: number } | undefined) =>
    x && finite(x.wacc) && x.wacc > 0 && x.wacc < 1 ? x : undefined;
  const financial = !!sic && /^(60|61|62|63|64|65|66|67)/.test(sic);
  const market = usable(
    data.nonFinancialMarket?.name === 'Total Market (without financials)' &&
      data.currency === 'USD'
      ? data.nonFinancialMarket
      : undefined,
  );
  let entry: { name: string; wacc: number } | undefined;
  let tier:
    'exact' | 'approximate' | 'nonfinancial-market' | 'manual' | 'unavailable' =
    'unavailable';
  let basisReason =
    '无法确认非金融企业或缺少有效参考，请主动选择行业或输入WACC';
  if (selected !== undefined) {
    entry = usable(data.industries.find((x) => x.name === selected));
    if (
      !entry &&
      selected === market?.name &&
      sic &&
      /^\d{4}$/.test(sic) &&
      !financial
    )
      entry = market;
    if (entry) {
      tier = 'manual';
      basisReason = '用户主动选择行业，采用该项官方Cost of Capital作为参考。';
    }
  } else if (sic && /^\d{4}$/.test(sic) && !financial) {
    entry = usable(data.industries.find((x) => x.name === SIC_WACC_MAP[sic]));
    if (entry) {
      tier = 'exact';
      basisReason = `精确SIC分类匹配：${sic} → ${entry.name}。`;
    }
    if (!entry) {
      const approximate = SIC_WACC_APPROXIMATIONS[sic];
      entry = usable(
        data.industries.find((x) => x.name === approximate?.industry),
      );
      if (entry) {
        tier = 'approximate';
        basisReason = approximate.basis;
      }
    }
    if (!entry && market) {
      entry = market;
      tier = 'nonfinancial-market';
      basisReason = `SIC ${sic}没有可用的精确或已配置近似行业，回退至官方美国非金融企业整体参考；不是该公司的行业估计。`;
    }
  }
  if (financial && selected === undefined)
    basisReason = '金融企业不自动套用美国非金融企业整体WACC。';
  return {
    ...(entry
      ? result(
          entry.wacc,
          `${entry.name}：Cost of Capital = ${entry.wacc * 100}%（${data.date}）`,
          null,
          [
            '行业或整体资本成本只作研究近似，不能代表公司的特定资本结构及风险。',
          ],
        )
      : result(null, 'Damodaran US Cost of Capital', basisReason)),
    industry: entry?.name ?? null,
    tier,
    basisReason,
  };
}
export function defaultTerminalGrowth(currency: string | null): SimpleEstimate {
  return currency === 'USD'
    ? result(0.02, '美元长期通胀参考 = 2%', null, [
        '参考美联储长期PCE通胀目标；对应成熟阶段实际增长约0%的简化情景，并非所有企业都能实现，仍需持续再投资。',
      ])
    : result(null, '长期通胀率参考', '未确认美元名义现金流，不自动套用2%');
}
export function usIncorporation(code: string | null): boolean | null {
  if (!code) return null;
  return 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'
    .split(' ')
    .includes(code)
    ? true
    : false;
}
