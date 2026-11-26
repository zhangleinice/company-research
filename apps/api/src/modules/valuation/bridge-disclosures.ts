import type {
  BridgeDisclosures,
  ValuationFact,
} from '@company-research/shared';
import type { NormalizedPeriod } from '../financials/normalize-company-facts';
interface RawFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
  form: string;
}
interface Raw {
  cik?: string | number;
  facts: Record<string, Record<string, { units: Record<string, RawFact[]> }>>;
}

/** Same-filing standardized facts and the existing coherent balance-sheet normalizer.
 * Narrow concepts retain their scope; no NCI/preferred subtotals are combined. */
export function bridgeDisclosures(
  raw: Raw,
  cik: string,
  filing: { end: string; filed: string; accn: string },
  normalized: { annual: NormalizedPeriod[]; quarterly: NormalizedPeriod[] },
): BridgeDisclosures {
  if (String(raw.cik).padStart(10, '0') !== cik) throw Error('CIK身份不匹配');
  const missing = (): ValuationFact => ({
    value: null,
    start: null,
    end: filing.end,
    concept: null,
    items: [],
  });
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accn.replaceAll('-', '')}/${filing.accn}-index.html`;
  const exact = (tag: string): ValuationFact => {
    const xs = (raw.facts['us-gaap']?.[tag]?.units.USD ?? []).filter(
      (f) =>
        !f.start &&
        f.end === filing.end &&
        f.accn === filing.accn &&
        f.filed <= filing.filed &&
        /^10-[KQ](\/A)?$/.test(f.form) &&
        Number.isFinite(f.val),
    );
    if (!xs.length) return missing();
    if (xs.some((f) => f.val !== xs[0].val))
      return {
        ...missing(),
        items: xs.map((f) => ({
          ...f,
          concept: `us-gaap:${tag}`,
          unit: 'USD',
          url,
          scopeConflict: true,
        })),
      };
    return {
      value: xs[0].val,
      start: null,
      end: filing.end,
      concept: `us-gaap:${tag}`,
      items: [{ ...xs[0], concept: `us-gaap:${tag}`, unit: 'USD', url }],
    };
  };
  // At a fiscal year end the disclosed annual weighted shares must not be
  // hidden by a derived Q4 row whose independent weighted shares are unknown.
  const row = [...normalized.annual, ...normalized.quarterly].find(
    (x) => x.periodEnd === filing.end,
  );
  const fromRow = (
    key:
      | 'cash'
      | 'marketableSecurities'
      | 'shortTermDebt'
      | 'longTermDebt'
      | 'totalDebt'
      | 'sharesOutstanding'
      | 'basicShares'
      | 'dilutedShares',
    duration = false,
  ): ValuationFact => {
    if (row?.[key] == null || !Number.isFinite(row[key])) return missing();
    return {
      value: row[key],
      start: duration ? row.periodStart : null,
      end: filing.end,
      concept: null,
      items: [
        {
          provenance: row.sources[key] ?? null,
          unit:
            key.includes('Shares') || key === 'sharesOutstanding'
              ? 'shares'
              : 'USD',
        },
      ],
    };
  };
  return {
    version: 1,
    cik,
    asOf: filing.end,
    items: {
      cash: fromRow('cash'),
      securities: fromRow('marketableSecurities'),
      shortDebt: fromRow('shortTermDebt'),
      longDebt: fromRow('longTermDebt'),
      totalDebt: fromRow('totalDebt'),
      commonShares: fromRow('sharesOutstanding'),
      basicShares: fromRow('basicShares', true),
      dilutedShares: fromRow('dilutedShares', true),
      longTermInvestments: exact('OtherLongTermInvestments'),
      operatingLeases: exact('OperatingLeaseLiability'),
      financeLeases: exact('FinanceLeaseLiability'),
      minority: exact('MinorityInterest'),
      noncontrollingVIE: exact(
        'NoncontrollingInterestInVariableInterestEntity',
      ),
      preferred: exact('PreferredStockValue'),
      convertiblePreferred: exact(
        'ConvertiblePreferredStockNonredeemableOrRedeemableIssuerOptionValue',
      ),
      lossContingenciesCurrent: exact(
        'LossContingencyAccrualCarryingValueCurrent',
      ),
      unrecognizedTaxBenefits: exact('UnrecognizedTaxBenefits'),
      noncurrentIncomeTaxes: exact('AccruedIncomeTaxesNoncurrent'),
    },
  };
}
