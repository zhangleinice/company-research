import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const text = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
export function cleanMergerRecords(raw: unknown) {
  if (!Array.isArray(raw))
    throw new BadGatewayException('FMP 返回的交易列表格式无效');
  const records = new Map();
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    const companyName = text(r.companyName),
      targetedCompanyName = text(r.targetedCompanyName),
      transactionDate = text(r.transactionDate),
      link = text(r.link);
    if (!companyName || !targetedCompanyName || !transactionDate || !link)
      continue;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate) ||
      !Number.isFinite(Date.parse(transactionDate)) ||
      new Date(transactionDate).toISOString().slice(0, 10) !== transactionDate
    )
      continue;
    try {
      const url = new URL(link);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'www.sec.gov' ||
        !url.pathname.startsWith('/Archives/') ||
        url.username ||
        url.password
      )
        continue;
    } catch {
      continue;
    }
    const cik = text(r.cik),
      targetedCik = text(r.targetedCik);
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          cik || companyName,
          targetedCik || targetedCompanyName,
          transactionDate,
          link,
        ]),
      )
      .digest('hex');
    records.set(id, {
      id,
      companyName,
      targetedCompanyName,
      transactionDate,
      link,
      cik,
      targetedCik,
      symbol: text(r.symbol),
      targetedSymbol: text(r.targetedSymbol),
      acceptedDate: text(r.acceptedDate),
      status: 'UNVERIFIED',
    });
  }
  return [...records.values()] as Array<{
    id: string;
    companyName: string;
    targetedCompanyName: string;
    transactionDate: string;
    link: string;
    cik: string | null;
    targetedCik: string | null;
    symbol: string | null;
    targetedSymbol: string | null;
    acceptedDate: string | null;
    status: string;
  }>;
}
@Injectable()
export class MergersService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async list(page: number, limit: number) {
    if (!(await this.db.mergerImport.findUnique({ where: { id: 'latest' } }))) {
      const key = this.config.get<string>('FMP_API_KEY')?.trim();
      if (!key) throw new ServiceUnavailableException('后端未配置 FMP_API_KEY');
      await this.db.$transaction(
        async (tx) => {
          // Serializes initial imports across API processes; successful empty results are cached too.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(746310017)`;
          if (await tx.mergerImport.findUnique({ where: { id: 'latest' } }))
            return;
          const url = new URL(
            'https://financialmodelingprep.com/stable/mergers-acquisitions-latest',
          );
          url.search = new URLSearchParams({
            page: '0',
            limit: '5',
            apikey: key,
          }).toString();
          let response: Response;
          try {
            response = await fetch(url, {
              signal: AbortSignal.timeout(15000),
              redirect: 'error',
            });
          } catch {
            throw new BadGatewayException('FMP 请求失败，请稍后重试');
          }
          const body = await response.text();
          if (!response.ok)
            throw new BadGatewayException(
              `FMP HTTP ${response.status}: ${body.replaceAll(key, '[REDACTED]').slice(0, 800)}`,
            );
          let raw: unknown;
          try {
            raw = JSON.parse(body);
          } catch {
            throw new BadGatewayException('FMP 返回了无效 JSON');
          }
          const records = cleanMergerRecords(raw);
          if (Array.isArray(raw) && raw.length && !records.length)
            throw new BadGatewayException('FMP 返回的数据没有可安全展示的记录');
          if (records.length)
            await tx.mergerDeal.createMany({
              data: records,
              skipDuplicates: true,
            });
          await tx.mergerImport.create({ data: { id: 'latest' } });
        },
        { timeout: 25000 },
      );
    }
    return this.db.$transaction(
      async (tx) => ({
        page,
        limit,
        total: await tx.mergerDeal.count(),
        data: await tx.mergerDeal.findMany({
          orderBy: [{ transactionDate: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        checkedAt: (
          await tx.mergerImport.findUniqueOrThrow({ where: { id: 'latest' } })
        ).checkedAt.toISOString(),
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
