import type {
  EnterpriseQuality,
  QualityCapitalSnapshot,
  ValuationBaseline,
  ValuationFact,
} from '@company-research/shared';

export const emptyQualityFact = (end = ''): ValuationFact => ({
  value: null,
  start: null,
  end,
  concept: null,
  items: [],
});

/** Partial old caches never trigger acquisition or infer missing facts. */
export function cachedQuality(
  ticker: string,
  baseline: ValuationBaseline | null,
): EnterpriseQuality {
  return (
    baseline?.quality ?? {
      version: 1,
      ticker,
      cik: baseline?.cik ?? null,
      start: baseline?.ocf?.start ?? null,
      asOf: baseline?.asOf ?? null,
      applicable: baseline?.applicable ?? null,
      netIncome: emptyQualityFact(),
      commonNetIncome: emptyQualityFact(),
      depreciationAmortization: emptyQualityFact(),
      depreciation: emptyQualityFact(),
      amortization: emptyQualityFact(),
      ebit: baseline?.ebit ?? emptyQualityFact(),
      capex: baseline?.capex ?? emptyQualityFact(),
      taxExpense: emptyQualityFact(),
      pretaxIncome: emptyQualityFact(),
      historicalTaxRate: null,
      capital: [],
    }
  );
}

export function historicalEffectiveTaxRate(
  tax: ValuationFact,
  pretax: ValuationFact,
): number | null {
  if (
    tax.value === null ||
    pretax.value === null ||
    pretax.value <= 0 ||
    !Number.isFinite(tax.value) ||
    !Number.isFinite(pretax.value) ||
    !tax.start ||
    tax.start !== pretax.start ||
    tax.end !== pretax.end ||
    !tax.items.length ||
    tax.items.length !== pretax.items.length ||
    tax.items.some(
      (x, i) =>
        typeof x.accn !== 'string' ||
        !x.accn ||
        x.unit !== 'USD' ||
        typeof x.start !== 'string' ||
        typeof x.end !== 'string' ||
        ['accn', 'start', 'end', 'unit'].some(
          (key) => x[key] !== pretax.items[i][key],
        ),
    )
  )
    return null;
  const rate = tax.value / pretax.value;
  return Number.isFinite(rate) ? rate : null;
}

export type { QualityCapitalSnapshot };
