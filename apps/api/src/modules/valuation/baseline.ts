import { bridgeDisclosures } from './bridge-disclosures';
import {
  historicalEffectiveTaxRate,
  type QualityCapitalSnapshot,
} from './enterprise-quality';
import { withResearchFcff } from './research-fcff';
import { historicalFcff } from '@company-research/shared';
import { normalizeCompanyFacts } from '../financials/normalize-company-facts';
import type {
  ValuationBaseline,
  ValuationFact,
} from '@company-research/shared';
interface Fact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
  form: string;
}
interface Raw {
  cik?: string | number;
  facts: Record<string, Record<string, { units: Record<string, Fact[]> }>>;
}
interface Sub {
  cik?: string | number;
  sic?: string;
  name?: string;
  filings: {
    recent: {
      form: string[];
      reportDate: string[];
      filingDate: string[];
      accessionNumber: string[];
    };
  };
}
export function valuationBaseline(
  raw: Raw,
  sub: Sub,
  ticker: string,
  cik: string,
): ValuationBaseline {
  if (
    String(raw.cik).padStart(10, '0') !== cik ||
    String(sub.cik).padStart(10, '0') !== cik
  )
    throw Error('CIK身份不匹配');
  const r = sub.filings.recent;
  const dates = r.form
    .flatMap((f, i) =>
      /^10-[KQ](\/A)?$/.test(f) && r.reportDate[i]
        ? [
            {
              end: r.reportDate[i],
              accn: r.accessionNumber[i],
              filed: r.filingDate[i],
            },
          ]
        : [],
    )
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
    );
  if (!dates.length) throw Error('没有可用10-K/10-Q申报');
  const latest = dates[0],
    normalized = normalizeCompanyFacts(raw);
  const annual = normalized.annual.find((a) => a.periodEnd <= latest.end),
    isAnnual = annual?.periodEnd === latest.end;
  const yearStart = annual
    ? isAnnual
      ? annual.periodStart
      : new Date(Date.parse(annual.periodEnd) + 86400000)
          .toISOString()
          .slice(0, 10)
    : null;
  function metric(tags: string[]): ValuationFact {
    for (const tag of tags) {
      const values = (raw.facts['us-gaap']?.[tag]?.units.USD ?? []).filter(
        (f) =>
          Number.isFinite(f.val) &&
          /^10-[KQ](\/A)?$/.test(f.form) &&
          f.filed <= latest.filed &&
          f.end <= latest.end,
      );
      const pick = (start: string, end: string, accn?: string) => {
        const matches = values
          .filter(
            (f) =>
              f.start === start && f.end === end && (!accn || f.accn === accn),
          )
          .sort(
            (a, b) =>
              b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn),
          );
        const v = matches[0];
        return v && !matches.some((f) => f.accn === v.accn && f.val !== v.val)
          ? v
          : undefined;
      };
      if (!yearStart || !annual) continue;
      const now = pick(yearStart, latest.end, latest.accn);
      if (!now) continue;
      let inputs: Fact[],
        start = yearStart,
        value = now.val;
      if (isAnnual) inputs = [now];
      else {
        const fy = pick(annual.periodStart, annual.periodEnd);
        const prior = values.find(
          (f) =>
            f.accn === latest.accn &&
            f.start === annual.periodStart &&
            Math.abs(
              (Date.parse(f.end) - Date.parse(latest.end)) / 86400000 + 365,
            ) <= 8 &&
            Math.abs(
              Date.parse(f.end) -
                Date.parse(f.start) -
                (Date.parse(latest.end) - Date.parse(yearStart)),
            ) <=
              8 * 86400000,
        );
        if (!fy || !prior) continue;
        inputs = [fy, now, prior];
        value = fy.val + now.val - prior.val;
        start = new Date(Date.parse(prior.end) + 86400000)
          .toISOString()
          .slice(0, 10);
      }
      return {
        value,
        start,
        end: latest.end,
        concept: `us-gaap:${tag}`,
        items: inputs.map((f) => ({
          ...f,
          unit: 'USD',
          concept: `us-gaap:${tag}`,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replaceAll('-', '')}/${f.accn}-index.html`,
        })),
      };
    }
    return {
      value: null,
      start: null,
      end: latest.end,
      concept: null,
      items: [],
    };
  }
  const revenue = metric([
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
    ]),
    ebit = metric(['OperatingIncomeLoss']),
    ocf = metric(['NetCashProvidedByUsedInOperatingActivities']),
    capex = metric(['PaymentsToAcquirePropertyPlantAndEquipment']),
    interest = metric([
      'InterestExpenseNonoperating',
      'InterestExpense',
      'InterestExpenseDebt',
    ]);
  const fcf =
    ocf.value !== null &&
    capex.value !== null &&
    capex.value >= 0 &&
    ocf.start === capex.start
      ? ocf.value - capex.value
      : null;
  const applicable =
    /^\d{4}$/.test(sub.sic ?? '') &&
    !/^(60|61|62|63|64|65|66|67)/.test(sub.sic ?? '');
  const taxExpense = metric(['IncomeTaxExpenseBenefit']);
  const pretaxIncome = metric([
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  ]);
  const start = ocf.start;
  const priorEnd = start
    ? new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10)
    : null;
  const capital: QualityCapitalSnapshot[] = [priorEnd, latest.end]
    .filter((end): end is string => end !== null)
    .map((end) => {
      const row = [...normalized.annual, ...normalized.quarterly].find(
        (x) => x.periodEnd === end,
      );
      const fact = (
        key: 'equity' | 'totalDebt' | 'cash' | 'marketableSecurities',
      ): ValuationFact => ({
        value: row?.[key] ?? null,
        start: null,
        end,
        concept: null,
        items: row?.sources[key] ? [{ provenance: row.sources[key] }] : [],
      });
      return {
        periodEnd: end,
        equity: fact('equity'),
        debt: fact('totalDebt'),
        cash: fact('cash'),
        securities: fact('marketableSecurities'),
      };
    });
  return withResearchFcff({
    bridgeDisclosures: bridgeDisclosures(raw, cik, latest, normalized),
    quality: {
      version: 1,
      ticker,
      cik,
      start,
      asOf: latest.end,
      applicable,
      netIncome: metric(['NetIncomeLoss']),
      commonNetIncome: metric([
        'NetIncomeLossAvailableToCommonStockholdersBasic',
      ]),
      depreciationAmortization: metric([
        'DepreciationDepletionAndAmortization',
        'DepreciationAndAmortization',
      ]),
      depreciation: metric(['Depreciation']),
      amortization: metric(['AmortizationOfIntangibleAssets']),
      ebit,
      capex,
      taxExpense,
      pretaxIncome,
      historicalTaxRate: historicalEffectiveTaxRate(taxExpense, pretaxIncome),
      capital,
    },
    ticker,
    cik,
    name: sub.name ?? null,
    asOf: latest.end,
    checkedAt: new Date().toISOString(),
    applicable,
    status: applicable ? 'REVIEW_REQUIRED' : 'NOT_APPLICABLE',
    warnings: [
      ...(!applicable
        ? ['金融类SIC或行业资料不足，无法适用普通FCFF模型。']
        : []),
      '历史FCF不是FCFF；利息现金分类、资本化、税盾尚未核准，简单预测禁用。',
      '现金不自动认定为非经营资产；债务/租赁、优先股、少数股东及稀释股数必须人工核实。',
      '未完成非经营利润、现金流及特殊融资调整。缺失历史数值不补零。',
    ],
    revenue,
    ebit,
    ocf,
    capex,
    interest,
    fcf,
    fcffChecks: {
      capitalizedInterest: metric(['InterestCostsCapitalized']),
      cashInterest: metric(['InterestPaidNet']),
      pretax: metric([
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
      ]),
    },
    fcff: historicalFcff(fcf, interest.value, null, {
      interestInOcf: false,
      adjustmentsReviewed: false,
      taxShieldReviewed: false,
    }),
  });
}
