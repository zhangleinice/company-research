import type { ValuationFact } from './dcf.js';

/** Disclosed amounts only, never approved equity-bridge adjustments. USD or shares. */
export type BridgeDisclosureKey =
  | 'cash'
  | 'securities'
  | 'longTermInvestments'
  | 'shortDebt'
  | 'longDebt'
  | 'totalDebt'
  | 'operatingLeases'
  | 'financeLeases'
  | 'minority'
  | 'noncontrollingVIE'
  | 'preferred'
  | 'convertiblePreferred'
  | 'lossContingenciesCurrent'
  | 'unrecognizedTaxBenefits'
  | 'commonShares'
  | 'basicShares'
  | 'dilutedShares';
export interface BridgeDisclosures {
  version: 1;
  cik: string;
  asOf: string;
  items: Record<BridgeDisclosureKey, ValuationFact> & {
    /** Additive: older successful caches legitimately lack this field. */
    noncurrentIncomeTaxes?: ValuationFact;
  };
}
