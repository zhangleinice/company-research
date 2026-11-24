import { DEBT_CASH_FLOW_TAGS } from './debt-cash-flows';
import type {
  AllocationSource,
  AllocationValue,
  AnnualCapitalAllocation,
  FinancialPeriod,
  FinancialMetric,
} from '@company-research/shared';
import { isObject } from './annual-financials';
import { capexToOperatingCashFlow } from './cash-flow-calculations';

/** Derive ratios from existing annual cache only; never infer common ownership. */
export function annualCapitalAllocation(
  row: FinancialPeriod,
  provenance: unknown,
  cik: string,
): AnnualCapitalAllocation {
  const missing = (reason: string): AllocationValue => ({
    value: null,
    reason,
    sources: [],
  });
  const sources = isObject(provenance) ? provenance : {};
  const duration =
    (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000 + 1;
  const annual =
    row.fiscalQuarter === null &&
    duration >= 330 &&
    duration <= 400 &&
    row.currency === 'USD';
  function fact(
    key: string,
    tags: string[],
    unit = 'USD',
    instant = false,
    storedValue: unknown = row[key as keyof FinancialPeriod],
  ): AllocationValue {
    const value = storedValue;
    const source = sources[key];
    if (
      !annual ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !isObject(source) ||
      source.method !== 'reported' ||
      !Array.isArray(source.items) ||
      source.items.length !== 1
    )
      return missing('缺少同一完整财年的可靠SEC来源');
    const f: unknown = source.items[0];
    if (
      !isObject(f) ||
      !tags.includes(String(f.concept)) ||
      f.unit !== unit ||
      f.val !== value ||
      f.end !== row.periodEnd ||
      (instant ? f.start !== undefined : f.start !== row.periodStart) ||
      typeof f.accn !== 'string' ||
      !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) ||
      typeof f.filed !== 'string' ||
      !Number.isFinite(Date.parse(f.filed)) ||
      f.filed < row.periodEnd ||
      !/^10-[KQ](\/A)?$/.test(String(f.form)) ||
      (isObject(f.dimensions) && Object.keys(f.dimensions).length > 0)
    )
      return missing('SEC期间、单位或归属口径尚未核准');
    const item: AllocationSource = {
      concept: String(f.concept),
      unit,
      end: row.periodEnd,
      ...(instant ? {} : { start: row.periodStart }),
      accessionNumber: f.accn,
      filed: f.filed,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
    };
    return { value, reason: null, sources: [item] };
  }
  const paid = fact('dividendsPaid', [
    'us-gaap:PaymentsOfDividendsCommonStock',
    'us-gaap:PaymentsOfDividends',
  ]);
  const scope =
    paid.sources[0]?.concept === 'us-gaap:PaymentsOfDividendsCommonStock'
      ? 'common'
      : paid.sources.length
        ? 'total'
        : 'unknown';
  const income = fact('netIncome', [
    'us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic',
  ]);
  const buyback = fact('stockRepurchases', [
    'us-gaap:PaymentsForRepurchaseOfCommonStock',
  ]);
  const ocf = fact('operatingCashFlow', [
    'us-gaap:NetCashProvidedByUsedInOperatingActivities',
  ]);
  const capex = fact('capex', [
    'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment',
  ]);
  const revenue = fact('revenue', [
    'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
    'us-gaap:Revenues',
    'us-gaap:SalesRevenueNet',
    'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax',
  ]);
  function ratio(
    a: AllocationValue,
    b: AllocationValue,
    reason: string,
  ): AllocationValue {
    if (a.value === null || b.value === null || a.value < 0 || b.value <= 0)
      return missing(reason);
    const value = (a.value / b.value) * 100;
    return Number.isFinite(value)
      ? { value, reason: null, sources: [...a.sources, ...b.sources] }
      : missing(reason);
  }
  const fcf =
    ocf.value !== null &&
    capex.value !== null &&
    capex.value >= 0 &&
    row.fcf !== null &&
    Math.abs(ocf.value - capex.value - row.fcf) < 0.000001
      ? {
          value: row.fcf,
          reason: null,
          sources: [...ocf.sources, ...capex.sources],
        }
      : missing('缺少同财年可靠FCF');
  const debtCashFlows = Object.fromEntries(
    Object.entries(DEBT_CASH_FLOW_TAGS).map(([key, tag]) => {
      const s = sources[key];
      const f = isObject(s) && Array.isArray(s.items) ? s.items[0] : undefined;
      const value = fact(
        key,
        [`us-gaap:${tag}`],
        'USD',
        false,
        isObject(f) ? f.val : null,
      );
      return [
        key,
        value.value !== null && value.value >= 0
          ? value
          : missing(
              isObject(s) && typeof s.reason === 'string'
                ? s.reason
                : '缺少同财年USD债务现金流汇总缓存或来源无法核准；不以分项、净额或债务余额估算',
            ),
      ];
    }),
  ) as NonNullable<AnnualCapitalAllocation['debtCashFlows']>;
  return {
    debtCashFlows,
    reinvestment: {
      capex:
        capex.value !== null && capex.value >= 0
          ? capex
          : missing('缺少可靠年度CapEx'),
      capexToOcf: {
        ...ratio(capex, ocf, '缺少同财年CapEx或正值OCF'),
        value: capexToOperatingCashFlow(capex.value, ocf.value),
      },
      capexToRevenue: ratio(capex, revenue, '缺少同财年CapEx或正值Revenue'),
    },
    references: Object.fromEntries(
      (
        [
          'dividendsPerShare',
          'dpsGrowth',
          'stockRepurchases',
          'dilutedSharesGrowth',
        ] as FinancialMetric[]
      ).map((key) => {
        const s = sources[key];
        const items = isObject(s) && Array.isArray(s.items) ? s.items : [];
        return [
          key,
          items.flatMap((f: unknown): AllocationSource[] => {
            if (
              !isObject(f) ||
              typeof f.accn !== 'string' ||
              !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) ||
              typeof f.concept !== 'string' ||
              typeof f.unit !== 'string' ||
              typeof f.end !== 'string' ||
              typeof f.filed !== 'string'
            )
              return [];
            return [
              {
                concept: f.concept,
                unit: f.unit,
                end: f.end,
                filed: f.filed,
                accessionNumber: f.accn,
                ...(typeof f.start === 'string' ? { start: f.start } : {}),
                url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
              },
            ];
          }),
        ];
      }),
    ),
    dividendsPaid: { ...paid, scope },
    sharesOutstanding: fact(
      'sharesOutstanding',
      ['us-gaap:CommonStockSharesOutstanding'],
      'shares',
      true,
    ),
    payoutRatio:
      scope !== 'common'
        ? missing(
            scope === 'total'
              ? '分红为宽口径总额，尚未确认普通股归属'
              : '缺少已核准的普通股现金分红',
          )
        : ratio(
            paid,
            income,
            income.value === null
              ? '缺少已核准的普通股股东可得净利润'
              : '普通股股东可得净利润须大于零',
          ),
    buybackToFcf: ratio(
      buyback,
      fcf,
      fcf.value === null
        ? '缺少同财年可靠FCF或回购来源'
        : fcf.value <= 0
          ? 'FCF为零或负值，不计算回购比例'
          : '缺少同财年可靠回购现金支出',
    ),
  };
}
