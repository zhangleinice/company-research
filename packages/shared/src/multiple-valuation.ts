import { SIC_WACC_MAP, SIC_WACC_APPROXIMATIONS } from './simple-valuation.js';
export const MULTIPLES_POLICY = 'pe-peg-v1';
export interface EpsReference {
  value: number | null;
  start: string | null;
  end: string;
  reason: string | null;
  sources: Record<string, unknown>[];
}
export interface MultipleYear {
  year: number | null;
  start: string;
  end: string;
  eps: EpsReference;
  roe: number | null; // decimal; existing annual ROE policy, not recomputed
  roeSources: Record<string, unknown>[];
  comparableCagr: { 3: number | null; 5: number | null }; // stored normalization validation, decimal
}
export interface MultipleInputs {
  version: 1;
  policy: typeof MULTIPLES_POLICY;
  cik: string;
  sic: string | null;
  ttm: EpsReference;
  annual: MultipleYear[];
  warnings: string[];
}
export interface IndustryPeData {
  date: string;
  source: string;
  page: string;
  field: string;
  industries: { name: string; pe: number | null }[];
}
export interface MultipleResult {
  value: number | null;
  reason: string | null;
  formula: string;
  warnings: string[];
}
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const safe = (value: number) => (Number.isFinite(value) ? value : null);
export function peValue(eps: number | null, pe: number | null): MultipleResult {
  const value = positive(eps) && positive(pe) ? safe(eps * pe) : null;
  return {
    value,
    reason: value === null ? '需要正EPS及有效正PE' : null,
    formula: `${eps ?? '—'} × ${pe ?? '—'} = ${value ?? '—'} 美元/股`,
    warnings: [],
  };
}
export function justifiedPe(
  roe: number | null,
  g: number | null,
  ke: number | null,
) {
  const valid =
    positive(roe) && finite(g) && g >= 0 && positive(ke) && g < ke && g < roe;
  const retention = valid ? g / roe : null;
  const payout = retention === null ? null : 1 - retention;
  const value = valid ? safe((payout! * (1 + g)) / (ke - g)) : null;
  return {
    value,
    retention,
    payout,
    reason: value === null ? '需满足ROE > 0、g ≥ 0、g < Ke且g < ROE' : null,
    formula: `(1 − ${g ?? '—'} / ${roe ?? '—'}) × (1 + ${g ?? '—'}) / (${ke ?? '—'} − ${g ?? '—'}) = ${value ?? '—'}`,
    warnings: [
      '单阶段稳定增长模型，适用于成熟稳定企业；不直接适用于高速增长阶段。',
    ],
  };
}
export function pegPe(
  growth: number | null,
  target: number | null,
): MultipleResult {
  const value =
    positive(growth) && positive(target) ? safe(growth * 100 * target) : null;
  return {
    value,
    reason: value === null ? 'EPS增长率及Target PEG必须为正' : null,
    formula: `${target ?? '—'} × (${growth === null ? '—' : growth * 100}%)的百分数 = ${value ?? '—'} 倍`,
    warnings: [
      'PEG=1为经验相对估值规则，并非严格内在价值公式；历史增长不代表未来增长。',
    ],
  };
}
/** No market-wide fallback: only configured SIC crosswalk or an explicit industry. */
export function multipleIndustry(sic: string | null, selected?: string | null) {
  if (selected) return { name: selected, basis: '用户选择行业' };
  const exact = sic ? SIC_WACC_MAP[sic] : null;
  const approximate = sic ? SIC_WACC_APPROXIMATIONS[sic] : null;
  return {
    name: exact ?? approximate?.industry ?? null,
    basis: exact
      ? `项目SIC ${sic}行业映射，非官方交叉表`
      : (approximate?.basis ??
        '无可靠行业映射，请主动选择，不采用全市场PE回退'),
  };
}
export function epsGrowth(years: MultipleYear[], n: 3 | 5): MultipleResult {
  const rows = [...years]
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, n + 1);
  const warnings = [
    '历史EPS增长不代表未来增长；需关注一次性损益、回购及股权稀释。',
    '异常低基数、亏损或重大波动可能使历史CAGR失真，不能机械外推。',
  ];
  const fail = (reason: string): MultipleResult => ({
    value: null,
    reason,
    formula: 'CAGR = (期末EPS / 期初EPS)^(1/年数) − 1',
    warnings,
  });
  if (rows.length !== n + 1) return fail(`需要${n + 1}个连续完整财年`);
  if (
    rows.some(
      (r, i) =>
        !positive(r.eps.value) ||
        (i > 0 &&
          (Math.abs(
            (Date.parse(rows[i - 1].end) - Date.parse(r.end)) / 86400000 - 365,
          ) > 10 ||
            rows[i - 1].year !== (r.year ?? 0) + 1)),
    )
  )
    return fail('期间缺失、不连续或历史EPS非正，无法形成可靠CAGR');
  const validated = rows[0].comparableCagr[n];
  const value = Math.pow(rows[0].eps.value! / rows[n].eps.value!, 1 / n) - 1;
  if (
    !finite(validated) ||
    !finite(value) ||
    Math.abs(validated - value) > 1e-6
  )
    return fail('缓存未核准跨年EPS可比性或拆股调整，不能仅按金额相除');
  if (
    rows.some(
      (r, i) =>
        i &&
        (r.eps.value! / rows[i - 1].eps.value! < 0.5 ||
          r.eps.value! / rows[i - 1].eps.value! > 2),
    )
  )
    warnings.push('历史EPS存在重大波动或异常低基数，CAGR可能失真。');
  return {
    value,
    reason: null,
    formula: `FY${rows[n].year} ${rows[n].eps.value} → FY${rows[0].year} ${rows[0].eps.value}；(${rows[0].eps.value} / ${rows[n].eps.value})^(1/${n}) − 1 = ${value * 100}%`,
    warnings,
  };
}
export function historicalRoe(years: MultipleYear[]): MultipleResult {
  const sorted = [...years].sort((a, b) => b.end.localeCompare(a.end));
  const latestYear = sorted[0]?.year;
  const rows = sorted
    .filter(
      (x) =>
        finite(latestYear) &&
        x.year !== null &&
        x.year >= latestYear - 4 &&
        x.year <= latestYear,
    )
    .slice(0, 5);
  const values = rows.map((x) => x.roe).filter((x): x is number => finite(x));
  const ordered = [...values].sort((a, b) => a - b),
    m = Math.floor(ordered.length / 2);
  const value = ordered.length
    ? ordered.length % 2
      ? ordered[m]
      : (ordered[m - 1] + ordered[m]) / 2
    : null;
  const warnings = ['历史ROE中位数仅作长期ROE近似，不保证未来可持续。'];
  if (values.length < 5)
    warnings.push(
      `最近五个完整财年仅${values.length}个有效ROE，参考数据不足。`,
    );
  if (values.some((x) => x > 1 || x <= 0))
    warnings.push(
      '存在异常高或非正ROE；低权益、回购及一次性损益可能扭曲长期回报率。',
    );
  if (
    rows.some((r) =>
      r.roeSources.some(
        (x) =>
          String(x.concept).includes('StockholdersEquity') &&
          finite(x.val) &&
          x.val <= 0,
      ),
    )
  )
    warnings.push('存在非正权益，历史ROE适用性受限。');
  return {
    value,
    reason: value === null ? '无有效历史ROE' : null,
    formula: `最近五年有效ROE中位数 = ${value === null ? '—' : value * 100 + '%'}（${values.length}/5期）`,
    warnings,
  };
}
