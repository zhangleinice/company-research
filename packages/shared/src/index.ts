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
