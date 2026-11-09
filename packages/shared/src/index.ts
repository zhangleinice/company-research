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
  'sharesOutstanding',
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
export type FinancialPeriod = Record<FinancialMetric, number | null> & {
  /** Derived by the API from cached same-period inputs; not a separate database column. */
  capexToOcf?: number | null;
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
    groups: {
      topic: string;
      findings: {
        kind: '公司披露的事实' | '管理层观点' | 'AI 推断';
        text: string;
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
