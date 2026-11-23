export interface SecEvidence {
  paragraphId: string;
  quote: string;
}
export interface CapitalNote {
  text: string;
  kind: 'fact' | 'plan' | 'risk';
  activityType?:
    | 'actualFinancing'
    | 'creditFacility'
    | 'commercialPaperProgram'
    | 'debtBalance'
    | 'plan'
    | 'other';
  evidence: SecEvidence[];
}
export interface AcquisitionEvent {
  targetName: string;
  transactionDate: {
    value: string;
    precision: 'year' | 'month' | 'day';
    type:
      | 'agreement'
      | 'announcement'
      | 'completion'
      | 'termination'
      | 'expectedCompletion';
    evidence: SecEvidence[];
  } | null;
  transactionValue: {
    rawText: string;
    currency: string | null;
    scope: 'cash' | 'total' | 'cashPlusDebt' | 'unknown';
    evidence: SecEvidence[];
  } | null;
  acquisitionPurpose: CapitalNote | null;
  transactionStatus:
    'announced' | 'pending' | 'completed' | 'terminated' | 'unknown';
  considerationType:
    'cash' | 'stock' | 'cashAndStock' | 'cashPlusDebt' | 'other' | 'unknown';
  evidence: SecEvidence[];
}
export interface CapitalAllocationInformation {
  version: 1;
  coverage: 'complete' | 'partial';
  coverageReason: string | null;
  reinvestment: {
    investmentAreas: CapitalNote[];
    investmentPurposes: CapitalNote[];
    investmentPlans: CapitalNote[];
    investmentRisks: CapitalNote[];
  };
  acquisitions: { events: AcquisitionEvent[] };
  debtAndFinancing: {
    financingActivities: CapitalNote[];
    financingPurposes: CapitalNote[];
    financingTerms: CapitalNote[];
    financingRisks: CapitalNote[];
  };
  source?: {
    filingId: string;
    cik: string;
    accessionNumber: string;
    filingType: string;
    fiscalYear: number;
    reportDate: string;
    filingDate: string;
    sourceUrl: string;
    item: 'Item 7';
    parserVersion: string;
    inputHash: string;
    /** Exact input paragraphs used by the validated citations, independent of later reparsing. */
    evidenceParagraphs: { id: string; text: string }[];
  };
}
