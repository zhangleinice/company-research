import {
  quarterlyRoicHistory,
  annualRoicHistory,
} from '../financials/annual-roic';
import {
  hasDebtBalanceFacts,
  type DebtDisclosure,
} from '../financials/debt-disclosure';
import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { SecModule } from '../sec/sec.module';
import { SecService } from '../sec/sec.service';
import { SecClient } from '../sec/sec.client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { valuationBaseline } from './baseline';
import { cachedQuality } from './enterprise-quality';
import { withResearchFcff } from './research-fcff';
import type { ValuationBaseline } from '@company-research/shared';
import type { Prisma } from '@prisma/client';
@Controller('companies/:ticker/valuation')
export class ValuationController {
  constructor(
    private readonly sec: SecService,
    private readonly client: SecClient,
    private readonly db: PrismaService,
  ) {}
  @Get() baseline(@Param('ticker') ticker: string) {
    return this.load(ticker, false);
  }
  /** Existing financial rows only; this route never acquires SEC data. */
  @Get('references') async references(@Param('ticker') ticker: string) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker))
      throw new BadRequestException('无效公司代码');
    const company = await this.sec.resolveCompany(ticker.toUpperCase());
    const where = { companyCik: company.cik };
    const [quarter, annual] = await Promise.all([
      this.db.quarterlyFinancial.findFirst({
        where,
        orderBy: { periodEnd: 'desc' },
      }),
      this.db.annualFinancial.findFirst({
        where,
        orderBy: { periodEnd: 'desc' },
      }),
    ]);
    const row =
      quarter && (!annual || quarter.periodEnd >= annual.periodEnd)
        ? quarter
        : annual;
    const numeric = (v: unknown) =>
      v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    const diluted = numeric(row?.dilutedShares),
      common = numeric(row?.sharesOutstanding);
    return {
      periodEnd: row?.periodEnd.toISOString().slice(0, 10) ?? null,
      cash: numeric(row?.cash),
      debt: numeric(row?.totalDebt),
      shares: diluted ?? common,
      sharesBasis:
        diluted !== null
          ? 'weightedDiluted'
          : common !== null
            ? 'currentCommon'
            : 'unknown',
      sources: Object.fromEntries(
        ['cash', 'totalDebt', 'dilutedShares', 'sharesOutstanding'].map(
          (key) => [
            key,
            row?.sources &&
            typeof row.sources === 'object' &&
            !Array.isArray(row.sources)
              ? (row.sources[key] ?? null)
              : null,
          ],
        ),
      ),
    };
  }
  /** Quality analysis reads existing database caches only, including negative/partial coverage. */
  @Get('quality') async quality(@Param('ticker') ticker: string) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker))
      throw new BadRequestException('无效公司代码');
    const company = await this.db.company.findFirst({
      include: {
        annualFinancials: { orderBy: { periodEnd: 'desc' }, take: 11 },
        quarterlyFinancials: { orderBy: { periodEnd: 'desc' }, take: 11 },
      },
      where: {
        OR: [
          { ticker: { equals: ticker, mode: 'insensitive' } },
          ...(/^\d{1,10}$/.test(ticker)
            ? [{ cik: ticker.padStart(10, '0') }]
            : []),
        ],
      },
    });
    const stored = await this.db.valuationCache.findFirst({
      where: {
        OR: [
          { data: { path: ['ticker'], equals: ticker.toUpperCase() } },
          ...(company ? [{ cik: company.cik }] : []),
        ],
      },
    });
    // An existing cache key can resolve an alias; ROIC amounts still come only
    // from annual_financials, even when the independent TTM cache is absent.
    const annualRows =
      company?.annualFinancials ??
      (stored?.cik && /^\d{10}$/.test(stored.cik)
        ? await this.db.annualFinancial.findMany({
            where: { companyCik: stored.cik },
            orderBy: { periodEnd: 'desc' },
            take: 11,
          })
        : []);
    const quarterlyRows =
      company?.quarterlyFinancials ??
      (stored?.cik && /^\d{10}$/.test(stored.cik)
        ? await this.db.quarterlyFinancial.findMany({
            where: { companyCik: stored.cik },
            orderBy: { periodEnd: 'desc' },
            take: 11,
          })
        : []);
    return {
      ...cachedQuality(
        ticker.toUpperCase(),
        (stored?.data as unknown as ValuationBaseline) ?? null,
      ),
      annualRoic: annualRoicHistory(annualRows),
      quarterlyRoic: quarterlyRoicHistory(quarterlyRows, annualRows),
    };
  }
  @Post('refresh') refresh(@Param('ticker') ticker: string) {
    return this.load(ticker, true);
  }
  async load(ticker: string, refresh = false) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(ticker))
      throw new BadRequestException('无效公司代码');
    const company = await this.sec.resolveCompany(ticker.toUpperCase());
    const stored = await this.db.valuationCache.findUnique({
      where: { cik: company.cik },
    });
    if (stored && !refresh)
      return withResearchFcff(stored.data as unknown as ValuationBaseline);
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`valuation:${company.cik}`}))`;
        const cache = await tx.valuationCache.findUnique({
          where: { cik: company.cik },
        });
        if (cache && !refresh)
          return withResearchFcff(cache.data as unknown as ValuationBaseline);
        try {
          const facts = await this.sec.getCompanyFacts(company.cik);
          const sub = await this.client.getJson(
            `https://data.sec.gov/submissions/CIK${company.cik}.json`,
          );
          let disclosures: DebtDisclosure[] = [];
          if (hasDebtBalanceFacts(facts)) {
            try {
              disclosures = (await this.sec.getDebtDisclosures(company.cik))
                .disclosures;
            } catch {
              /* A failed optional fallback never invents debt or discards existing SEC facts. */
            }
          }
          const data = valuationBaseline(
            facts as Parameters<typeof valuationBaseline>[0],
            sub as Parameters<typeof valuationBaseline>[1],
            ticker.toUpperCase(),
            company.cik,
            disclosures,
          );
          await tx.valuationCache.upsert({
            where: { cik: company.cik },
            create: {
              cik: company.cik,
              data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
            },
            update: {
              data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
            },
          });
          return data;
        } catch {
          throw new BadGatewayException(
            '估值财务基准暂不可用；未启动AI或完整更新，请重试',
          );
        }
      },
      { timeout: 60000 },
    );
  }
}
@Module({
  imports: [SecModule, PrismaModule],
  controllers: [ValuationController],
})
export class ValuationModule {}
