import type { CompanyFinancials } from '@company-research/shared';

type Metric =
  'revenue' | 'netIncome' | 'operatingCashFlow' | 'capitalExpenditure';
export interface FactSource {
  tag: string;
  unit: 'USD';
  start: string;
  end: string;
  filed: string;
  form: string;
  accession: string;
}
export interface FinancialSummary extends Omit<CompanyFinancials, 'ticker'> {
  sources: Partial<Record<Metric | 'previousRevenue', FactSource>>;
}
interface Observation {
  start: string;
  end: string;
  filed: string;
  form: string;
  accn: string;
  fy?: number;
  fp?: string;
  val: number;
}
interface Candidate {
  tag: string;
  observation: Observation;
}
const TAGS: Record<Metric, string[]> = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capitalExpenditure: ['PaymentsToAcquirePropertyPlantAndEquipment'],
};
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function date(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function annual(value: unknown): value is Observation {
  if (
    !isObject(value) ||
    !date(value.start) ||
    !date(value.end) ||
    !date(value.filed)
  )
    return false;
  const days = (Date.parse(value.end) - Date.parse(value.start)) / 86400000;
  return (
    days >= 330 &&
    days <= 400 &&
    value.end <= value.filed &&
    typeof value.form === 'string' &&
    /^(10-K|20-F|40-F)(\/A)?$/.test(value.form) &&
    (value.fp === undefined || value.fp === 'FY') &&
    typeof value.accn === 'string' &&
    typeof value.val === 'number' &&
    Number.isFinite(value.val)
  );
}
function source(candidate: Candidate): FactSource {
  const observation = candidate.observation;
  return {
    tag: `us-gaap:${candidate.tag}`,
    unit: 'USD',
    start: observation.start,
    end: observation.end,
    filed: observation.filed,
    form: observation.form,
    accession: observation.accn,
  };
}
function latest(candidates: Candidate[]): Candidate | undefined {
  return [...candidates].sort(
    (a, b) =>
      b.observation.filed.localeCompare(a.observation.filed) ||
      b.observation.accn.localeCompare(a.observation.accn),
  )[0];
}

/** Conservative annual-only mapping. Unsupported units/tags and short transition years stay null. */
export function summarizeAnnualFacts(raw: unknown): FinancialSummary {
  const result: FinancialSummary = {
    fiscalYear: null,
    periodEnd: null,
    currency: null,
    revenue: null,
    revenueGrowth: null,
    netIncome: null,
    netMargin: null,
    operatingCashFlow: null,
    capitalExpenditure: null,
    freeCashFlow: null,
    sources: {},
  };
  if (!isObject(raw) || !isObject(raw.facts) || !isObject(raw.facts['us-gaap']))
    return result;
  const facts = raw.facts['us-gaap'];
  const candidates = new Map<Metric, Candidate[]>();
  for (const [metric, tags] of Object.entries(TAGS) as [Metric, string[]][]) {
    const entries: Candidate[] = [];
    for (const tag of tags) {
      const fact = facts[tag];
      if (
        !isObject(fact) ||
        !isObject(fact.units) ||
        !Array.isArray(fact.units.USD)
      )
        continue;
      for (const observation of fact.units.USD) {
        if (annual(observation)) entries.push({ tag, observation });
      }
    }
    candidates.set(metric, entries);
  }
  const all = [...candidates.values()].flat();
  if (!all.length) return result;
  // Use actual observation periods, never fy alone: later filings contain historical comparisons.
  const end = all
    .map((x) => x.observation.end)
    .sort()
    .at(-1)!;
  const current = all.filter((x) => x.observation.end === end);
  // Earliest original filing for the latest period supplies its fiscal-year label.
  const anchor = [...current].sort(
    (a, b) =>
      a.observation.filed.localeCompare(b.observation.filed) ||
      TAGS.revenue.indexOf(b.tag) - TAGS.revenue.indexOf(a.tag),
  )[0].observation;
  result.periodEnd = end;
  result.currency = 'USD';
  result.fiscalYear = Number.isInteger(anchor.fy) ? anchor.fy! : null;
  let selectedRevenue: Candidate | undefined;
  for (const [metric, tags] of Object.entries(TAGS) as [Metric, string[]][]) {
    for (const tag of tags) {
      const selected = latest(
        candidates
          .get(metric)!
          .filter(
            (x) =>
              x.tag === tag &&
              x.observation.start === anchor.start &&
              x.observation.end === end,
          ),
      );
      if (!selected) continue;
      if (metric === 'capitalExpenditure' && selected.observation.val < 0)
        continue;
      result[metric] = selected.observation.val;
      result.sources[metric] = source(selected);
      if (metric === 'revenue') selectedRevenue = selected;
      break;
    }
  }
  if (selectedRevenue) {
    // Compare the same revenue concept and adjacent full years, avoiding gaps or mixed definitions.
    const previous = latest(
      candidates.get('revenue')!.filter((x) => {
        const gap =
          (Date.parse(anchor.start) - Date.parse(x.observation.end)) / 86400000;
        return x.tag === selectedRevenue!.tag && gap >= 1 && gap <= 8;
      }),
    );
    if (previous) {
      result.sources.previousRevenue = source(previous);
      if (previous.observation.val > 0)
        result.revenueGrowth =
          (result.revenue! / previous.observation.val - 1) * 100;
    }
  }
  if (
    result.revenue !== null &&
    result.revenue > 0 &&
    result.netIncome !== null
  )
    result.netMargin = (result.netIncome / result.revenue) * 100;
  if (result.operatingCashFlow !== null && result.capitalExpenditure !== null)
    result.freeCashFlow = result.operatingCashFlow - result.capitalExpenditure;
  // JSON has no representation for Infinity or NaN.
  for (const key of ['revenueGrowth', 'netMargin', 'freeCashFlow'] as const) {
    if (result[key] !== null && !Number.isFinite(result[key]))
      result[key] = null;
  }
  return result;
}
