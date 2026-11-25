import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  OWNER_EARNINGS_POLICY,
  OWNER_EARNINGS_INPUT_VERSION,
  type OwnerEarningsDraft,
  type OwnerEarningsEstimate,
  type OwnerEarningsFact,
  type OwnerEarningsResponse,
  type OwnerEarningsResults,
  type OwnerEarningsYear,
} from '@company-research/shared';
import { isObject } from '../financials/annual-financials';
import {
  missingOwnerFact,
  ownerReportedFact,
} from '../financials/owner-earnings-inputs';

const date = (v: string | Date) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v;
const number = (v: unknown) =>
  v == null ||
  typeof v === 'boolean' ||
  (typeof v === 'string' && !v.trim()) ||
  !Number.isFinite(Number(v))
    ? null
    : Number(v);
export interface OwnerStoredYear {
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodStart: string | Date;
  periodEnd: string | Date;
  currency: string | null;
  revenue: unknown;
  netIncome: unknown;
  operatingCashFlow: unknown;
  capex: unknown;
  fcf: unknown;
  sources: unknown;
}
const validDate = z.iso.date();
export const ownerDraftSchema = z
  .object({
    periodStart: validDate,
    periodEnd: validDate,
    dataVersion: z.string().regex(/^[a-f0-9]{64}$/),
    method: z.enum(['ratio', 'amount']),
    ratio: z.number().finite().min(0).max(100).nullable(),
    amount: z
      .number()
      .finite()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER / 1e6)
      .nullable(),
    comparable: z.boolean(),
    rationale: z.string().max(10000),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (
      (d.method === 'ratio' &&
        (d.ratio === null || d.amount !== null || !d.comparable)) ||
      (d.method === 'amount' && (d.amount === null || d.ratio !== null))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          '请明确输入当前方式的估计；比例方式必须确认同期间、同范围的现金CapEx拆分',
      });
  });

export function ownerEarningsHistory(
  cik: string,
  rows: readonly OwnerStoredYear[],
): OwnerEarningsYear[] {
  return rows
    .filter(
      (r) =>
        r.fiscalQuarter === null &&
        r.currency === 'USD' &&
        z.iso.date().safeParse(date(r.periodStart)).success &&
        z.iso.date().safeParse(date(r.periodEnd)).success &&
        (Date.parse(date(r.periodEnd)) - Date.parse(date(r.periodStart))) /
          86400000 >=
          329 &&
        (Date.parse(date(r.periodEnd)) - Date.parse(date(r.periodStart))) /
          86400000 <=
          399,
    )
    .sort((a, b) => date(b.periodEnd).localeCompare(date(a.periodEnd)))
    .slice(0, 10)
    .map((r) => {
      const start = date(r.periodStart),
        end = date(r.periodEnd),
        sources = isObject(r.sources) ? r.sources : {};
      const read = (
        key: 'revenue' | 'netIncome' | 'operatingCashFlow' | 'capex',
        tags: string[],
      ) => {
        const s = sources[key];
        const f = ownerReportedFact(
          isObject(s) ? s.items : null,
          number(r[key]),
          cik,
          start,
          end,
        );
        return f.sources.length && !tags.includes(f.sources[0].concept)
          ? missingOwnerFact('披露标签未核准')
          : f;
      };
      const revenue = read('revenue', [
        'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
        'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax',
        'us-gaap:Revenues',
        'us-gaap:SalesRevenueNet',
      ]);
      const netIncome = read('netIncome', [
        'us-gaap:NetIncomeLoss',
        'us-gaap:ProfitLoss',
      ]);
      const operatingCashFlow = read('operatingCashFlow', [
        'us-gaap:NetCashProvidedByUsedInOperatingActivities',
      ]);
      const capex = read('capex', [
        'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment',
      ]);
      if (capex.value !== null && capex.value < 0)
        Object.assign(capex, missingOwnerFact('现金CapEx金额异常'));
      const envelope = sources.ownerEarningsInputs;
      const supplemental = (
        key: 'depreciationAmortization' | 'sbc',
        tag: string,
      ): OwnerEarningsFact => {
        if (
          !isObject(envelope) ||
          envelope.version !== OWNER_EARNINGS_INPUT_VERSION ||
          envelope.periodStart !== start ||
          envelope.periodEnd !== end
        )
          return missingOwnerFact('旧缓存尚未包含核准的年度D&A／SBC输入');
        const item = envelope[key];
        if (!isObject(item) || item.value === null)
          return missingOwnerFact(
            isObject(item) && typeof item.reason === 'string'
              ? item.reason
              : '年度输入缺失',
          );
        const f = ownerReportedFact(
          item.sources,
          number(item.value),
          cik,
          start,
          end,
        );
        const ocfSource = operatingCashFlow.sources[0];
        if (
          f.value === null ||
          f.value < 0 ||
          !ocfSource ||
          f.sources[0].concept !== tag ||
          f.sources[0].accn !== ocfSource.accn ||
          f.sources[0].filed !== ocfSource.filed
        )
          return missingOwnerFact('金额、标签或年度现金流申报范围未通过核准');
        return f;
      };
      const depreciationAmortization = supplemental(
        'depreciationAmortization',
        'us-gaap:DepreciationDepletionAndAmortization',
      );
      const sbc = supplemental('sbc', 'us-gaap:ShareBasedCompensation');
      const sameFiling =
        operatingCashFlow.sources[0]?.accn === capex.sources[0]?.accn;
      // Reuse the persisted FCF, verify its existing policy rather than changing it.
      const fcf: OwnerEarningsFact =
        operatingCashFlow.value !== null &&
        capex.value !== null &&
        sameFiling &&
        number(r.fcf) === operatingCashFlow.value - capex.value
          ? {
              value: number(r.fcf),
              reason: null,
              sources: [...operatingCashFlow.sources, ...capex.sources],
            }
          : missingOwnerFact(
              '缺少同期间、同申报的OCF／现金CapEx或FCF核对不一致',
            );
      const ratio = (f: OwnerEarningsFact) =>
        f.value !== null && revenue.value !== null && revenue.value > 0
          ? (f.value / revenue.value) * 100
          : null;
      const facts = {
        netIncome,
        operatingCashFlow,
        depreciationAmortization,
        capex,
        fcf,
        sbc,
        revenue,
      };
      const dataVersion = createHash('sha256')
        .update(
          JSON.stringify({
            cik,
            start,
            end,
            fy: r.fiscalYear,
            version: OWNER_EARNINGS_INPUT_VERSION,
            facts,
          }),
        )
        .digest('hex');
      return {
        fiscalYear: r.fiscalYear,
        periodStart: start,
        periodEnd: end,
        currency: 'USD',
        dataVersion,
        netIncomeScope:
          netIncome.sources[0]?.concept === 'us-gaap:NetIncomeLoss'
            ? 'parent'
            : netIncome.sources[0]?.concept === 'us-gaap:ProfitLoss'
              ? 'consolidated'
              : 'unknown',
        ...facts,
        capexToRevenue: ratio(capex),
        daToRevenue: ratio(depreciationAmortization),
      };
    });
}

export function calculateOwnerEarnings(
  year: OwnerEarningsYear | undefined,
  draft: OwnerEarningsDraft | null,
  confirmed: boolean,
): OwnerEarningsResults {
  const empty: OwnerEarningsResults = {
    maintenanceCapex: null,
    growthCapex: null,
    growthReason: '估计尚未确认',
    ownerEarnings: null,
    sbcAdjustedOwnerEarnings: null,
  };
  if (
    !year ||
    !confirmed ||
    !draft ||
    !ownerDraftSchema.safeParse(draft).success ||
    draft.dataVersion !== year.dataVersion ||
    draft.periodStart !== year.periodStart ||
    draft.periodEnd !== year.periodEnd
  )
    return empty;
  const maintenance =
    draft.method === 'ratio'
      ? year.capex.value === null
        ? null
        : (year.capex.value * draft.ratio!) / 100
      : draft.amount! * 1e6;
  if (maintenance === null || !Number.isFinite(maintenance)) return empty;
  const growth =
    draft.comparable &&
    year.capex.value !== null &&
    maintenance <= year.capex.value
      ? year.capex.value - maintenance
      : null;
  const oe =
    year.operatingCashFlow.value === null
      ? null
      : year.operatingCashFlow.value - maintenance;
  const finite = (v: number | null) =>
    v !== null && Number.isFinite(v) ? v : null;
  return {
    maintenanceCapex: maintenance,
    growthCapex: finite(growth),
    growthReason:
      growth === null
        ? '正常年度估计与当期现金CapEx未确认可比、基准缺失或估计超过当期支出，无法可靠拆分'
        : null,
    ownerEarnings: finite(oe),
    sbcAdjustedOwnerEarnings: finite(
      year.operatingCashFlow.value === null || year.sbc.value === null
        ? null
        : year.operatingCashFlow.value - year.sbc.value - maintenance,
    ),
  };
}

export function ownerResponse(
  cik: string,
  ticker: string,
  history: OwnerEarningsYear[],
  estimate: OwnerEarningsEstimate | null,
): OwnerEarningsResponse {
  const latest = history[0];
  const confirmed =
    !!latest &&
    !!estimate &&
    estimate.cik === cik &&
    estimate.policyVersion === OWNER_EARNINGS_POLICY &&
    estimate.dataVersion === latest.dataVersion &&
    estimate.periodStart === latest.periodStart &&
    estimate.periodEnd === latest.periodEnd;
  return {
    cik,
    ticker,
    policyVersion: OWNER_EARNINGS_POLICY,
    history,
    estimate,
    estimateStatus: !estimate
      ? 'none'
      : confirmed
        ? 'confirmed'
        : 'needs_reconfirmation',
    results: calculateOwnerEarnings(
      latest,
      estimate
        ? {
            periodStart: estimate.periodStart,
            periodEnd: estimate.periodEnd,
            dataVersion: estimate.dataVersion,
            method: estimate.method,
            ratio: estimate.ratio,
            amount: estimate.amount,
            comparable: estimate.comparable,
            rationale: estimate.rationale,
          }
        : null,
      confirmed,
    ),
  };
}
