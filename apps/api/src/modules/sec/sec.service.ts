import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SecClient } from './sec.client';

import type {
  Company,
  CompanyListItem,
  CompanyListResponse,
} from '@company-research/shared';

type Profile = Omit<Company, 'ticker'>;
const TICKER_TTL = 24 * 60 * 60 * 1000;
const PROFILE_TTL = 60 * 60 * 1000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
export function normalizeCik(value: unknown): string {
  const cik = String(value);
  if (!/^\d{1,10}$/.test(cik) || Number(cik) === 0)
    throw new BadGatewayException('SEC returned an invalid CIK');
  return cik.padStart(10, '0');
}

@Injectable()
export class SecService {
  private tickers?: { value: Map<string, CompanyListItem>; expires: number };
  private tickerRequest?: Promise<Map<string, CompanyListItem>>;
  private readonly profiles = new Map<
    string,
    { value: Profile; expires: number }
  >();
  private readonly inFlight = new Map<string, Promise<Profile>>();

  constructor(private readonly client: SecClient) {}

  async getCompanies(
    page: number,
    limit: number,
    query = '',
  ): Promise<CompanyListResponse> {
    const directory = await this.getTickers();
    const term = query.trim().toLowerCase();
    const companies = [...directory.values()].filter(
      (item) =>
        !term ||
        item.ticker.toLowerCase().includes(term) ||
        item.name?.toLowerCase().includes(term),
    );
    const start = (page - 1) * limit;
    return {
      source: 'SEC',
      total: companies.length,
      page,
      limit,
      data: companies.slice(start, start + limit),
    };
  }

  async getCompany(ticker: string): Promise<Company> {
    const company = (await this.getTickers()).get(ticker);
    if (!company)
      throw new NotFoundException(`Company ticker ${ticker} not found`);
    return { ticker, ...(await this.getProfile(company.cik)) };
  }

  async resolveCompany(input: string): Promise<CompanyListItem> {
    const directory = await this.getTickers();
    const company = /^\d{1,10}$/.test(input)
      ? [...directory.values()].find((item) => item.cik === normalizeCik(input))
      : directory.get(input.trim().toUpperCase());
    if (!company)
      throw new NotFoundException('Company not found in SEC directory');
    return company;
  }

  async getCompanyFacts(cik: string): Promise<unknown> {
    const expected = normalizeCik(cik);
    const data = await this.client.getJson(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${expected}.json`,
    );
    if (
      !object(data) ||
      normalizeCik(data.cik) !== expected ||
      !object(data.facts)
    )
      throw new BadGatewayException('SEC returned invalid company facts');
    return data;
  }

  private async getTickers(): Promise<Map<string, CompanyListItem>> {
    if (this.tickers && this.tickers.expires > Date.now())
      return this.tickers.value;
    if (!this.tickerRequest) {
      this.tickerRequest = this.loadTickers().finally(() => {
        this.tickerRequest = undefined;
      });
    }
    return this.tickerRequest;
  }

  private async loadTickers(): Promise<Map<string, CompanyListItem>> {
    const data = await this.client.getJson(
      'https://www.sec.gov/files/company_tickers.json',
    );
    if (!object(data) || Object.keys(data).length === 0)
      throw new BadGatewayException('SEC returned an invalid ticker mapping');
    const value = new Map<string, CompanyListItem>();
    for (const row of Object.values(data)) {
      if (!object(row) || typeof row.ticker !== 'string' || !row.ticker.trim())
        throw new BadGatewayException('SEC returned an invalid ticker entry');
      const ticker = row.ticker.toUpperCase();
      value.set(ticker, {
        ticker,
        cik: normalizeCik(row.cik_str),
        name: text(row.title),
      });
    }
    this.tickers = { value, expires: Date.now() + TICKER_TTL };
    return value;
  }

  private async getProfile(cik: string): Promise<Profile> {
    const cached = this.profiles.get(cik);
    if (cached && cached.expires > Date.now()) return cached.value;
    let request = this.inFlight.get(cik);
    if (!request) {
      request = this.loadProfile(cik).finally(() => {
        this.inFlight.delete(cik);
      });
      this.inFlight.set(cik, request);
    }
    return request;
  }

  private async loadProfile(cik: string): Promise<Profile> {
    const data = await this.client.getJson(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
    );
    if (!object(data) || normalizeCik(data.cik) !== cik)
      throw new BadGatewayException(
        'SEC returned an invalid submissions response',
      );
    const value: Profile = {
      cik,
      name: text(data.name),
      sic:
        typeof data.sic === 'number' && Number.isFinite(data.sic)
          ? String(data.sic)
          : text(data.sic),
      industry: text(data.sicDescription),
      fiscalYearEnd: text(data.fiscalYearEnd),
    };
    // Bound memory use; the least recently inserted profile is evicted first.
    this.profiles.delete(cik);
    if (this.profiles.size >= 500)
      this.profiles.delete(this.profiles.keys().next().value!);
    this.profiles.set(cik, { value, expires: Date.now() + PROFILE_TTL });
    return value;
  }
}
