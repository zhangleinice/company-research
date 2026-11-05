import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  FINANCIAL_METRICS,
  type CompanyDetail,
  type CompanyListItem,
  type FinancialMode,
  type FinancialPeriod,
  type ResearchCompany,
  type ResearchListResponse,
} from '@company-research/shared';
import { SecService, normalizeCik } from '../sec/sec.service';
import { FinancialService } from '../financials/financial.service';
import { PrismaService } from '../prisma/prisma.service';
import type { NormalizedPeriod } from '../financials/normalize-company-facts';

type Stored = Prisma.CompanyGetPayload<{
  include: { annualFinancials: true; quarterlyFinancials: true };
}>;
type StoredPeriod = Stored['annualFinancials'][number];
const financialRelations = {
  annualFinancials: { orderBy: { periodEnd: 'desc' as const }, take: 10 },
  quarterlyFinancials: { orderBy: { periodEnd: 'desc' as const }, take: 10 },
};
const listRelations = {
  annualFinancials: { orderBy: { periodEnd: 'desc' as const }, take: 1 },
  quarterlyFinancials: { orderBy: { periodEnd: 'desc' as const }, take: 1 },
};
function period(row: StoredPeriod): FinancialPeriod {
  return {
    ...Object.fromEntries(
      FINANCIAL_METRICS.map((key) => [
        key,
        row[key] === null ? null : Number(row[key]),
      ]),
    ),
    fiscalYear: row.fiscalYear,
    fiscalQuarter: row.fiscalQuarter,
    periodStart: row.periodStart.toISOString().slice(0, 10),
    periodEnd: row.periodEnd.toISOString().slice(0, 10),
    currency: row.currency,
  } as FinancialPeriod;
}
function item(
  base: CompanyListItem,
  stored: Stored | undefined,
  mode: FinancialMode,
): ResearchCompany {
  const data =
    mode === 'annual'
      ? stored?.annualFinancials[0]
      : stored?.quarterlyFinancials[0];
  return {
    ...base,
    id: stored?.id ?? null,
    industry: stored?.industry ?? null,
    isFavorite: stored?.isFavorite ?? false,
    financialStatus: stored?.financialStatus ?? 'NOT_FETCHED',
    lastFetchedAt: stored?.lastFetchedAt?.toISOString() ?? null,
    financial: data ? period(data) : null,
  };
}
function writePeriod(cik: string, row: NormalizedPeriod) {
  return {
    companyCik: cik,
    fiscalYear: row.fiscalYear,
    fiscalQuarter: row.fiscalQuarter,
    periodStart: new Date(row.periodStart),
    periodEnd: new Date(row.periodEnd),
    currency: row.currency,
    ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, row[key]])),
    sources: JSON.parse(JSON.stringify(row.sources)) as Prisma.InputJsonValue,
  };
}

@Injectable()
export class CompanyService {
  private readonly pending = new Map<string, Promise<CompanyDetail>>();
  constructor(
    private readonly sec: SecService,
    private readonly financials: FinancialService,
    private readonly prisma: PrismaService,
  ) {}

  private pagination(page: number, limit: number) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequestException(
        'page must be positive; limit must be between 1 and 100',
      );
  }
  private query(value: string) {
    if (typeof value !== 'string' || value.length > 120)
      throw new BadRequestException('Search query is too long');
    return value.trim();
  }
  private mode(value: string): FinancialMode {
    if (value !== 'annual' && value !== 'quarterly')
      throw new BadRequestException('mode must be annual or quarterly');
    return value;
  }
  async search(query: string) {
    const term = this.query(query);
    return term ? (await this.sec.getCompanies(1, 20, term)).data : [];
  }
  async getCompanies(
    page = 1,
    limit = 10,
    query = '',
    selectedMode = 'annual',
    favorites = false,
  ): Promise<ResearchListResponse> {
    this.pagination(page, limit);
    const term = this.query(query);
    const mode = this.mode(selectedMode);
    if (favorites) {
      const where: Prisma.CompanyWhereInput = {
        isFavorite: true,
        ...(term
          ? {
              OR: [
                { ticker: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.company.count({ where }),
        this.prisma.company.findMany({
          where,
          orderBy: { ticker: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: listRelations,
        }),
      ]);
      return {
        mode,
        total,
        page,
        limit,
        data: rows.map((row) => item(row, row, mode)),
      };
    }
    const directory = await this.sec.getCompanies(page, limit, term);
    const stored = await this.prisma.company.findMany({
      where: {
        cik: { in: [...new Set(directory.data.map((row) => row.cik))] },
      },
      include: listRelations,
    });
    const byCik = new Map(stored.map((row) => [row.cik, row]));
    return {
      mode,
      total: directory.total,
      page,
      limit,
      data: directory.data.map((row) => item(row, byCik.get(row.cik), mode)),
    };
  }
  async setFavorite(
    input: string,
    isFavorite: unknown,
  ): Promise<{ cik: string; isFavorite: boolean }> {
    if (typeof isFavorite !== 'boolean')
      throw new BadRequestException('isFavorite must be boolean');
    const company = await this.resolve(input);
    await this.prisma.company.upsert({
      where: { cik: company.cik },
      create: { ...company, isFavorite },
      update: { isFavorite },
    });
    return { cik: company.cik, isFavorite };
  }
  private async resolve(input: string): Promise<CompanyListItem> {
    if (!/^(?:\d{1,10}|[A-Z0-9][A-Z0-9.-]{0,19})$/i.test(input))
      throw new BadRequestException('Invalid company identifier');
    if (/^0+$/.test(input)) throw new BadRequestException('Invalid CIK');
    const identifier = input.toUpperCase();
    const stored = await this.prisma.company.findFirst({
      where: /^\d+$/.test(identifier)
        ? { cik: normalizeCik(identifier) }
        : { ticker: identifier },
    });
    if (stored)
      return { ticker: stored.ticker, cik: stored.cik, name: stored.name };
    return this.sec.resolveCompany(identifier);
  }
  async getCompany(input: string): Promise<CompanyDetail> {
    const company = await this.resolve(input);
    // INSERT ... ON CONFLICT DO NOTHING is safe even for the first simultaneous alias requests.
    await this.prisma.company.createMany({
      data: [company],
      skipDuplicates: true,
    });
    const stored = await this.prisma.company.findUniqueOrThrow({
      where: { cik: company.cik },
      include: financialRelations,
    });
    if (stored.financialStatus === 'READY') return this.detail(stored);
    const existing = this.pending.get(company.cik);
    if (existing) return existing;
    const request = this.fetchFinancials(company).finally(() =>
      this.pending.delete(company.cik),
    );
    this.pending.set(company.cik, request);
    return request;
  }
  private detail(stored: Stored): CompanyDetail {
    return {
      ...item(stored, stored, 'annual'),
      annual: stored.annualFinancials.map(period),
      quarterly: stored.quarterlyFinancials.map(period),
      lastError: stored.lastError,
    };
  }
  private async fetchFinancials(
    company: CompanyListItem,
  ): Promise<CompanyDetail> {
    const token = randomUUID();
    const claimed = await this.prisma.company.updateMany({
      where: {
        cik: company.cik,
        OR: [
          { financialStatus: { in: ['NOT_FETCHED', 'FAILED'] } },
          {
            financialStatus: 'FETCHING',
            fetchStartedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
          },
        ],
      },
      data: {
        financialStatus: 'FETCHING',
        fetchStartedAt: new Date(),
        fetchToken: token,
        lastError: null,
      },
    });
    if (!claimed.count) {
      const current = await this.prisma.company.findUniqueOrThrow({
        where: { cik: company.cik },
        include: financialRelations,
      });
      return this.detail(current);
    }
    try {
      const facts = await this.sec.getCompanyFacts(company.cik);
      const parsed = this.financials.normalize(facts);
      if (!parsed.annual.length && !parsed.quarterly.length)
        throw new BadGatewayException(
          'SEC has no supported annual or independent quarterly data for this company',
        );
      // Basic submissions enrich industry when available; failure never invents or blocks financial data.
      const basic = await this.sec.getCompany(company.ticker).catch(() => null);
      await this.prisma.$transaction(
        async (tx) => {
          const owns = await tx.company.updateMany({
            where: {
              cik: company.cik,
              fetchToken: token,
              financialStatus: 'FETCHING',
            },
            data: {
              financialStatus: 'READY',
              lastFetchedAt: new Date(),
              fetchStartedAt: null,
              fetchToken: null,
              lastError: null,
              ...(basic?.industry ? { industry: basic.industry } : {}),
            },
          });
          if (!owns.count)
            throw new ConflictException(
              'The data acquisition lease has changed; retry the detail request',
            );
          for (const row of parsed.annual) {
            const data = writePeriod(company.cik, row);
            await tx.annualFinancial.upsert({
              where: {
                companyCik_periodEnd: {
                  companyCik: company.cik,
                  periodEnd: data.periodEnd,
                },
              },
              create: data,
              update: data,
            });
          }
          for (const row of parsed.quarterly) {
            const data = writePeriod(company.cik, row);
            await tx.quarterlyFinancial.upsert({
              where: {
                companyCik_periodEnd: {
                  companyCik: company.cik,
                  periodEnd: data.periodEnd,
                },
              },
              create: data,
              update: data,
            });
          }
        },
        { timeout: 20000 },
      );
      return this.detail(
        await this.prisma.company.findUniqueOrThrow({
          where: { cik: company.cik },
          include: financialRelations,
        }),
      );
    } catch (error) {
      await this.prisma.company.updateMany({
        where: { cik: company.cik, fetchToken: token },
        data: {
          financialStatus: 'FAILED',
          fetchToken: null,
          fetchStartedAt: null,
          lastError: '财务数据获取失败，请重试；详情见服务端安全错误日志',
        },
      });
      throw error;
    }
  }
}
