import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OWNER_EARNINGS_POLICY,
  type OwnerEarningsEstimate,
  type OwnerEarningsDraft,
  type OwnerEarningsPreview,
} from '@company-research/shared';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  ownerDraftSchema,
  ownerEarningsHistory,
  ownerResponse,
  calculateOwnerEarnings,
} from './owner-earnings';

@Injectable()
export class OwnerEarningsService {
  constructor(private readonly db: PrismaService) {}
  private draft(body: unknown): OwnerEarningsDraft {
    // Ratio mode is by definition a split of current cash PP&E CapEx.
    const input =
      body &&
      typeof body === 'object' &&
      'method' in body &&
      body.method === 'ratio'
        ? { ...body, comparable: true }
        : body;
    const parsed = ownerDraftSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    return parsed.data;
  }
  private async company(identifier: string) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/i.test(identifier))
      throw new BadRequestException('无效公司标识');
    const company = await this.db.company.findFirst({
      where: {
        OR: [
          { ticker: { equals: identifier, mode: 'insensitive' } },
          ...(/^\d{1,10}$/.test(identifier)
            ? [{ cik: identifier.padStart(10, '0') }]
            : []),
        ],
      },
    });
    if (!company)
      throw new NotFoundException('公司尚无本地财务记录；未请求SEC数据');
    return company;
  }
  async read(identifier: string) {
    const company = await this.company(identifier);
    return this.db.$transaction((tx) => this.response(tx, company), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  private async response(
    tx: Prisma.TransactionClient,
    company: { cik: string; ticker: string },
  ) {
    const rows = await tx.annualFinancial.findMany({
      where: { companyCik: company.cik },
      orderBy: { periodEnd: 'desc' },
      take: 10,
    });
    const history = ownerEarningsHistory(company.cik, rows);
    const saved = history[0]
      ? await tx.ownerEarningsEstimate.findUnique({
          where: {
            companyCik_periodEnd: {
              companyCik: company.cik,
              periodEnd: new Date(history[0].periodEnd),
            },
          },
        })
      : null;
    const estimate = saved
      ? {
          ...(saved.data as unknown as OwnerEarningsEstimate),
          cik: company.cik,
          createdAt: saved.createdAt.toISOString(),
          updatedAt: saved.updatedAt.toISOString(),
        }
      : null;
    return ownerResponse(company.cik, company.ticker, history, estimate);
  }
  async save(identifier: string, body: unknown) {
    const draft = this.draft(body),
      company = await this.company(identifier);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const current = await this.response(tx, company),
            year = current.history[0];
          if (
            !year ||
            year.dataVersion !== draft.dataVersion ||
            year.periodStart !== draft.periodStart ||
            year.periodEnd !== draft.periodEnd
          )
            throw new ConflictException(
              '财务数据或最新财年已变化，请重新读取并确认估计',
            );
          if (draft.method === 'ratio' && year.capex.value === null)
            throw new BadRequestException('现金CapEx缺失，无法使用比例估计');
          await tx.ownerEarningsEstimate.upsert({
            where: {
              companyCik_periodEnd: {
                companyCik: company.cik,
                periodEnd: new Date(year.periodEnd),
              },
            },
            create: {
              companyCik: company.cik,
              periodEnd: new Date(year.periodEnd),
              data: {
                ...draft,
                cik: company.cik,
                fiscalYear: year.fiscalYear,
                capexBasis: year.capex.value,
                policyVersion: OWNER_EARNINGS_POLICY,
              },
            },
            update: {
              data: {
                ...draft,
                cik: company.cik,
                fiscalYear: year.fiscalYear,
                capexBasis: year.capex.value,
                policyVersion: OWNER_EARNINGS_POLICY,
              },
            },
          });
          return this.response(tx, company);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException(
          '财务数据或研究记录同时发生变化，请重新读取后确认',
        );
      throw error;
    }
  }
  async preview(
    identifier: string,
    body: unknown,
  ): Promise<OwnerEarningsPreview> {
    const draft = this.draft(body);
    const data = await this.read(identifier),
      year = data.history[0];
    const samePeriod =
      year &&
      draft.periodStart === year.periodStart &&
      draft.periodEnd === year.periodEnd;
    // An updated baseline may be previewed, but save still requires its new fingerprint.
    // Never carry an estimate into a different fiscal period.
    return {
      data,
      results: samePeriod
        ? calculateOwnerEarnings(
            year,
            { ...draft, dataVersion: year.dataVersion },
            true,
          )
        : calculateOwnerEarnings(year, null, false),
    };
  }
}
@Controller('companies/:identifier/owner-earnings')
export class OwnerEarningsController {
  constructor(private readonly service: OwnerEarningsService) {}
  @Get() read(@Param('identifier') identifier: string) {
    return this.service.read(identifier);
  }
  @Post() save(@Param('identifier') identifier: string, @Body() body: unknown) {
    return this.service.save(identifier, body);
  }
  @Post('preview')
  @HttpCode(200)
  preview(@Param('identifier') identifier: string, @Body() body: unknown) {
    return this.service.preview(identifier, body);
  }
}
@Module({
  imports: [PrismaModule],
  controllers: [OwnerEarningsController],
  providers: [OwnerEarningsService],
})
export class OwnerEarningsModule {}
