import {
  depreciationAmortization as completeDepreciation,
  ownerDepreciationFact,
} from './depreciation-amortization';
import {
  OWNER_EARNINGS_INPUT_VERSION,
  type OwnerEarningsFact,
  type OwnerEarningsInputs,
  type OwnerEarningsSource,
} from '@company-research/shared';
import { isObject } from './annual-financials';

export const missingOwnerFact = (reason: string): OwnerEarningsFact => ({
  value: null,
  reason,
  sources: [],
});
export const ownerSourceUrl = (cik: string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${accession}-index.html`;

/** Only full-year, entity-wide USD facts from the OCF filing are eligible. */
export function ownerReportedFact(
  items: unknown,
  value: number | null,
  cik: string,
  start: string,
  end: string,
): OwnerEarningsFact {
  if (
    value === null ||
    !Number.isFinite(value) ||
    !Array.isArray(items) ||
    items.length !== 1
  )
    return missingOwnerFact('缺少同年度原始披露及来源');
  const f: unknown = items[0];
  if (
    !isObject(f) ||
    f.start !== start ||
    f.end !== end ||
    f.unit !== 'USD' ||
    f.val !== value ||
    typeof f.concept !== 'string' ||
    !/^us-gaap:/.test(f.concept) ||
    typeof f.accn !== 'string' ||
    !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) ||
    typeof f.filed !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(f.filed) ||
    !Number.isFinite(Date.parse(f.filed)) ||
    f.filed < end ||
    typeof f.form !== 'string' ||
    !/^10-K(\/A)?$/.test(f.form)
  )
    return missingOwnerFact('年度、单位或SEC申报来源未通过校验');
  const source: OwnerEarningsSource = {
    concept: f.concept,
    unit: 'USD',
    start,
    end,
    accn: f.accn,
    filed: f.filed,
    form: f.form,
    val: value,
    url: ownerSourceUrl(cik, f.accn),
  };
  return { value, reason: null, sources: [source] };
}

export function annualOwnerEarningsInputs(
  raw: unknown,
  cik: string,
  period: {
    periodStart: string;
    periodEnd: string;
    operatingCashFlow: number | null;
    sources: Record<string, unknown>;
  },
  depreciationAmortization?: OwnerEarningsFact,
): OwnerEarningsInputs {
  const { periodStart: start, periodEnd: end } = period;
  const source = period.sources.operatingCashFlow;
  const ocf = ownerReportedFact(
    isObject(source) ? source.items : null,
    period.operatingCashFlow,
    cik,
    start,
    end,
  );
  const facts =
    isObject(raw) && isObject(raw.facts) && isObject(raw.facts['us-gaap'])
      ? raw.facts['us-gaap']
      : {};
  const identityMatches =
    isObject(raw) && String(raw.cik).padStart(10, '0') === cik;
  const read = (tag: string) => {
    if (!identityMatches || ocf.value === null)
      return missingOwnerFact('缺少相同申报的年度OCF，无法核准合并范围');
    const concept = facts[tag];
    const units =
      isObject(concept) && isObject(concept.units) ? concept.units.USD : null;
    const matches = Array.isArray(units)
      ? units
          .filter(isObject)
          .filter(
            (f) =>
              f.start === start &&
              f.end === end &&
              f.accn === ocf.sources[0].accn &&
              f.filed === ocf.sources[0].filed &&
              /^10-K(\/A)?$/.test(String(f.form)),
          )
      : [];
    if (!matches.length)
      return missingOwnerFact(
        `缺少同一年度及申报的完整 ${tag}；不以折旧分项或含其他调整的合计替代`,
      );
    const value = matches[0].val;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      matches.some((f) => f.val !== value)
    )
      return missingOwnerFact('原始金额冲突或口径未核准');
    return ownerReportedFact(
      [{ ...matches[0], unit: 'USD', concept: `us-gaap:${tag}` }],
      value,
      cik,
      start,
      end,
    );
  };
  return {
    version: OWNER_EARNINGS_INPUT_VERSION,
    periodStart: start,
    periodEnd: end,
    depreciationAmortization:
      depreciationAmortization ??
      ownerDepreciationFact(
        completeDepreciation(raw, cik, {
          value: ocf.value,
          start,
          end,
          concept: 'us-gaap:NetCashProvidedByUsedInOperatingActivities',
          items: ocf.sources.map((s) => ({ ...s })),
        }),
      ),
    sbc: read('ShareBasedCompensation'),
  };
}
