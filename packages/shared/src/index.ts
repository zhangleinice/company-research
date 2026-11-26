/** Data contracts only: no NestJS, persistence or SEC client dependencies. */
export interface Company {
  ticker: string;
  cik: string;
  name: string | null;
  sic: string | null;
  industry: string | null;
  fiscalYearEnd: string | null;
}

export interface CompanyListItem {
  ticker: string;
  cik: string;
  name: string | null;
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  limit: number;
  data: T[];
}

export interface CompanyListResponse extends PaginatedResponse<CompanyListItem> {
  source: 'SEC';
}

/** Single-company success responses are unwrapped Company objects. */
export type CompanyResponse = Company;

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
}

/** Percentages use percentage points: 12.5 means 12.5%, not 0.125. */
export interface CompanyFinancials {
  ticker: string;
  fiscalYear: number | null;
  periodEnd: string | null;
  currency: 'USD' | null;
  revenue: number | null;
  revenueGrowth: number | null;
  netIncome: number | null;
  netMargin: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  freeCashFlow: number | null;
}

export interface FinancialListResponse extends PaginatedResponse<CompanyFinancials> {
  source: 'SEC';
  status: 'ready' | 'not_initialized' | 'unavailable';
  updatedAt: string | null;
  warning?: string;
}

export const FINANCIAL_METRICS = [
  'revenue',
  'grossProfit',
  'operatingIncome',
  'netIncome',
  'eps',
  'cash',
  'marketableSecurities',
  'currentAssets',
  'currentLiabilities',
  'assets',
  'liabilities',
  'equity',
  'shortTermDebt',
  'longTermDebt',
  'totalDebt',
  'operatingCashFlow',
  'capex',
  'fcf',
  'stockRepurchases',
  'dividendsPaid',
  'dividendsPerShare',
  'dpsGrowth',
  'sharesOutstanding',
  'dilutedShares',
  'basicShares',
  'dilutedSharesGrowth',
  'revenueGrowth',
  'epsGrowth',
  'fcfGrowth',
  'netIncomeGrowth',
  'grossMargin',
  'operatingMargin',
  'netMargin',
  'roe',
  'roa',
  'fcfMargin',
  'netDebt',
  'debtToEquity',
  'currentRatio',
  'sharesChange',
  'bookValuePerShare',
  'revenueCagr3y',
  'revenueCagr5y',
  'epsCagr3y',
  'epsCagr5y',
  'fcfCagr3y',
  'fcfCagr5y',
] as const;
export type FinancialMetric = (typeof FINANCIAL_METRICS)[number];
export type FinancialMode = 'annual' | 'quarterly';
export type FinancialStatus = 'NOT_FETCHED' | 'FETCHING' | 'READY' | 'FAILED';
export interface AllocationSource {
  concept: string;
  unit: string;
  start?: string;
  end: string;
  accessionNumber: string;
  filed: string;
  url: string;
}
export interface AllocationValue {
  value: number | null;
  reason: string | null;
  sources: AllocationSource[];
}
export interface AnnualCapitalAllocation {
  overview?: import('./capital-allocation-overview.js').CapitalAllocationOverview;
  debtCashFlows?: {
    debtIssuance: AllocationValue;
    debtRepayments: AllocationValue;
  };
  reinvestment?: {
    capex: AllocationValue;
    capexToOcf: AllocationValue;
    capexToRevenue: AllocationValue;
  };
  references: Partial<Record<FinancialMetric, AllocationSource[]>>;
  dividendsPaid: AllocationValue & { scope: 'common' | 'total' | 'unknown' };
  sharesOutstanding: AllocationValue;
  payoutRatio: AllocationValue;
  buybackToFcf: AllocationValue;
}
export type FinancialPeriod = Record<FinancialMetric, number | null> & {
  /** Read-only derivatives of existing annual cache values and SEC provenance. */
  capitalAllocation?: AnnualCapitalAllocation;
  /** Derived by the API from cached same-period inputs; not a separate database column. */
  capexToOcf?: number | null;
  /** OCF / same-period net income * 100, percentage points. Nonpositive earnings or missing inputs => null.
   * Read-time deterministic derivative; not a separate database column. */
  cashConversionRatio?: number | null;
  interestCoverage?: number | null;
  interestCoverageDetails?: {
    policyVersion: 'operating-income-interest-v1';
    status:
      | 'READY'
      | 'MISSING_DATA'
      | 'REVIEW_REQUIRED'
      | 'INVALID_INPUT'
      | 'NOT_APPLICABLE';
    reason: string | null;
    operatingIncome: number | null;
    interestExpense: number | null;
    sources: Record<string, unknown>[];
  };
  /** Only present as reliable values when SEC combined-current-liquidity provenance reconciles. */
  cashAndShortTermSecurities?: number | null;
  netDebtAfterLiquidAssets?: number | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodStart: string;
  periodEnd: string;
  currency: string | null;
};
export interface ResearchCompany extends CompanyListItem {
  id: string | null;
  industry: string | null;
  isFavorite: boolean;
  financialStatus: FinancialStatus;
  lastFetchedAt: string | null;
  financial: FinancialPeriod | null;
}
export interface ResearchListResponse extends PaginatedResponse<ResearchCompany> {
  mode: FinancialMode;
}
export interface CompanyDetail extends ResearchCompany {
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
  lastError: string | null;
}

export type AiResearchKind = 'business' | 'management';
export interface AiResearchSummary {
  fiscalYear: number;
  filingDate: string;
  accessionNumber: string;
  section: string;
  model: string;
  promptVersion: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  summaryJson: {
    extraction?: {
      strategy?: 'whole-item-v1';
      item: 'Item 1' | 'Item 1A' | 'Item 7';
      filingId: string;
      cik: string;
      accessionNumber: string;
      parserVersion: string;
      inputHash: string;
      language: 'zh-CN';
      evidenceParagraphs: { id: string; text: string }[];
    };
    unavailableItems?: ('Item 1' | 'Item 1A' | 'Item 7')[];
    itemSources?: {
      item: 'Item 1' | 'Item 1A' | 'Item 7';
      accessionNumber: string;
      sourceUrl: string;
      fiscalYear: number;
      filingDate: string;
      generatedAt: string;
      promptVersion: string;
      legacy: boolean;
    }[];
    capitalAllocation?: import('./capital-information.js').CapitalAllocationInformation;
    groups: {
      topic: string;
      findings: {
        kind: '公司披露的事实' | '管理层观点' | 'AI 推断';
        text: string;
        riskType?: string;
        impact?: string | null;
        businessName?: string;
        offering?: string;
        monetization?: string;
        evidence: { paragraphId: string; quote: string }[];
      }[];
    }[];
  };
}
export interface AiResearchState {
  status: 'NOT_GENERATED' | 'GENERATING' | 'READY' | 'FAILED';
  error: string | null;
  summary: AiResearchSummary | null;
  cached?: boolean;
}

export type UpdateStage = 'financials' | 'filing' | 'business' | 'management';
export interface CompanyUpdateProgress {
  mode: 'FULL' | 'INITIAL';
  stages: Record<
    UpdateStage,
    {
      status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
      error?: string;
      updatedAt?: string;
    }
  >;
}
export interface CompanyUpdateState {
  status: 'IDLE' | 'QUEUED' | 'GENERATING' | 'READY' | 'PARTIAL' | 'FAILED';
  updatedAt: string | null;
  error: string | null;
  progress: CompanyUpdateProgress | null;
}

/** Exact integer USD amounts remain strings through storage and transport. */
export interface RevenueFact {
  value: string;
  fiscalYear: number;
  unit: 'USD';
  concept: string;
  accessionNumber: string;
  sourceUrl: string;
  factUrl: string;
  context: {
    id: string;
    cik: string;
    start: string;
    end: string;
    dimensions: { dimension: string; member: string }[];
  };
  yoy: {
    value: number | null;
    reason: string;
    priorPeriod?: { start: string; end: string };
  };
}
export interface RevenueGroup {
  tableIndex: number;
  tableId: string | null;
  header: string;
  sourceUrl: string;
  accessionNumber: string;
  rows: {
    rowIndex: number;
    name: string;
    originalRow: string;
    facts: RevenueFact[];
  }[];
}
export interface RevenueBreakdownResponse {
  status: string;
  accessionNumber: string | null;
  sourceUrl: string | null;
  fiscalYear: number | null;
  extractedAt: string | null;
  groups: RevenueGroup[];
}

export interface MergerListResponse {
  page: number;
  limit: number;
  total: number;
  checkedAt: string;
  data: {
    id: string;
    companyName: string;
    symbol: string | null;
    targetedCompanyName: string;
    targetedSymbol: string | null;
    transactionDate: string;
    acceptedDate: string | null;
    link: string;
    status: string;
  }[];
}

export * from './dcf.js';

export * from './equity-bridge.js';

export * from './company-websites.js';

export * from './enterprise-quality.js';

export * from './bridge-disclosures.js';
export * from './capital-information.js';

/** Business summary generation format; legacy cached JSON remains readable. */
export const BUSINESS_MODEL_PROMPT_VERSION = 'business-model-v4';
export const BUSINESS_MODEL_TOPICS = [
  '公司做什么？',
  '公司怎么赚钱？',
  '未来有哪些增长机会？',
] as const;

export * from './balance-sheet-inputs.js';

export * from './annual-roic.js';
export * from './owner-earnings.js';
export * from './equity-bridge-research.js';

export * from './equity-defaults.js';

export * from './simple-valuation.js';

export * from './operating-working-capital.js';

export * from './ebit-fcff.js';

export * from './multiple-valuation.js';

export * from './margin-of-safety.js';

export * from './capital-allocation-overview.js';

export * from './capital-sankey.js';
