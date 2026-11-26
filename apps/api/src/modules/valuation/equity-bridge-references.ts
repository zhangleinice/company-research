import { createHash } from 'node:crypto';
import type {
  EquityBridgeReferences,
  ResearchReference,
  ResearchReferenceKey,
  ValuationBaseline,
  BalanceSheetInputs,
} from '@company-research/shared';
import { isObject } from '../financials/annual-financials';

export interface BridgeStoredRow {
  periodStart?: Date;
  periodEnd: Date;
  sources?: unknown;
  cash?: unknown;
  marketableSecurities?: unknown;
  totalDebt?: unknown;
  shortTermDebt?: unknown;
  longTermDebt?: unknown;
  sharesOutstanding?: unknown;
  basicShares?: unknown;
  dilutedShares?: unknown;
}
const numeric = (v: unknown) =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Cache-only references. Annual weighted shares remain annual, never a derived Q4. */
export function equityBridgeReferences(
  cik: string,
  annual: BridgeStoredRow | null,
  quarter: BridgeStoredRow | null,
  cached: unknown,
): EquityBridgeReferences {
  const row =
    quarter && (!annual || quarter.periodEnd > annual.periodEnd)
      ? quarter
      : (annual ?? quarter);
  const asOf = row ? iso(row.periodEnd) : '';
  const missing = (
    reason = '当前缓存缺少可靠披露，不能推定为0',
  ): ResearchReference => ({
    value: null,
    start: null,
    end: asOf,
    concept: null,
    items: [],
    status: 'MISSING',
    reason,
  });
  const sources = row && isObject(row.sources) ? row.sources : {};
  const b = sources.balanceSheetInputs as BalanceSheetInputs | undefined;
  const coherent = b?.version === 2 && b.periodEnd === asOf;
  const approved = (
    key:
      | 'cash'
      | 'currentFinancialInvestments'
      | 'financingDebt'
      | 'financeLeases',
  ): ResearchReference => {
    const input = coherent ? b[key] : null;
    if (
      !input ||
      input.status !== 'VERIFIED' ||
      input.value === null ||
      typeof input.value !== 'number' ||
      !Number.isFinite(input.value)
    )
      return missing(input?.reason ?? '缺少version 2核准输入');
    return {
      value: input.value,
      start: null,
      end: asOf,
      concept: null,
      items: input.items,
      status: 'VERIFIED',
      reason: null,
    };
  };
  const fromRow = (
    r: BridgeStoredRow | null | undefined,
    key: keyof BridgeStoredRow,
    duration = false,
  ): ResearchReference => {
    const value = numeric(r?.[key]);
    if (!r || value === null) return missing();
    const s = isObject(r.sources) ? r.sources : {};
    const item = s[key];
    return {
      value,
      start: duration && r.periodStart ? iso(r.periodStart) : null,
      end: iso(r.periodEnd),
      concept: null,
      items:
        isObject(item) && Array.isArray(item.items)
          ? item.items
          : [{ provenance: item ?? s.totalDebt ?? null }],
      status: 'DISCLOSED',
      reason: null,
    };
  };
  const baseline = cached as ValuationBaseline | null;
  const disclosure = (
    key: keyof NonNullable<ValuationBaseline['bridgeDisclosures']>['items'],
  ): ResearchReference => {
    const d = baseline?.bridgeDisclosures;
    const f = d?.cik === cik && d.asOf === asOf ? d.items[key] : null;
    return f?.value != null &&
      Number.isFinite(f.value) &&
      f.end === asOf &&
      f.start === null
      ? { ...f, status: 'DISCLOSED', reason: null }
      : {
          ...missing(
            f?.items.some((item) => item.scopeConflict === true)
              ? '同申报披露金额存在冲突，不能自动采用'
              : undefined,
          ),
          items: f?.items ?? [],
        };
  };
  const facts: EquityBridgeReferences['facts'] = {
    cash: approved('cash'),
    shortInvestments: approved('currentFinancialInvestments'),
    financingDebt: approved('financingDebt'),
    financeLeases: approved('financeLeases'),
    shortDebt: fromRow(row, 'shortTermDebt'),
    longDebt: fromRow(row, 'longTermDebt'),
    plainDebt: fromRow(row, 'totalDebt'),
    longInvestments: disclosure('longTermInvestments'),
    minority: disclosure('minority'),
    narrowMinority: disclosure('noncontrollingVIE'),
    preferred: disclosure('preferred'),
    convertiblePreferred: disclosure('convertiblePreferred'),
    operatingLeases: disclosure('operatingLeases'),
    lossContingencies: disclosure('lossContingenciesCurrent'),
    taxClaims: disclosure('unrecognizedTaxBenefits'),
    noncurrentTaxClaims: disclosure('noncurrentIncomeTaxes'),
    pensionClaims: missing(
      '现有缓存未提供核准的养老金缺口；不能据此认定不存在',
    ),
    otherClaims: missing('各类索偿不能机械加总，需独立研究估计'),
    shares: fromRow(row, 'sharesOutstanding'),
    annualBasicShares: fromRow(annual, 'basicShares', true),
    annualDilutedShares: fromRow(annual, 'dilutedShares', true),
    quarterBasicShares: fromRow(quarter, 'basicShares', true),
    quarterDilutedShares: fromRow(quarter, 'dilutedShares', true),
  };
  facts.longInvestments.reason =
    '仅覆盖当前已缓存的OtherLongTermInvestments等披露；不是全部长期投资，也不等于可加回的经济价值';
  if (facts.shares.value === null && annual)
    facts.shares = fromRow(annual, 'sharesOutstanding');
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : isObject(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, stable(value[k])]),
          )
        : value;
  const debtComponents: Record<string, ResearchReference> = {};
  if (coherent)
    for (const [tag, input] of Object.entries(b.debtComponents ?? {})) {
      if (
        ![
          'LongTermDebtAndCapitalLeaseObligations',
          'LongTermDebtAndCapitalLeaseObligationsCurrent',
        ].includes(tag)
      )
        continue;
      if (
        input.status === 'VERIFIED' &&
        typeof input.value === 'number' &&
        Number.isFinite(input.value)
      )
        debtComponents[tag] = {
          value: input.value,
          start: null,
          end: asOf,
          concept: `us-gaap:${tag}`,
          items: input.items,
          status: 'VERIFIED',
          reason:
            '已核准的组合披露分项；不得机械加总为完整融资债务，亦不能重复加入已采用的总额',
        };
    }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        stable({
          cik,
          asOf,
          facts,
          debtComponents,
          version: 1,
          financingDebtIncludesLeases: coherent
            ? b.financeLeasesIncludedInDebt
            : null,
        }),
      ),
    )
    .digest('hex');
  // Preserve all actual period/source metadata, including different annual/quarter durations.
  return {
    version: 1,
    cik,
    asOf,
    fingerprint,
    facts: facts as Record<ResearchReferenceKey, ResearchReference>,
    financingDebtIncludesLeases: coherent
      ? b.financeLeasesIncludedInDebt
      : null,
    debtComponents,
  };
}
