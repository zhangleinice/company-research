import { load } from 'cheerio';
import { qname } from './parser/facts.cjs';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, RevenueBreakdownCache } from '@prisma/client';
import type {
  RevenueBreakdownResponse,
  RevenueGroup,
} from '@company-research/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecClient } from '../sec/sec.client';
import { latest10K, type FilingMetadata } from '../ai-research/filing-parser';
import { extractTables } from './parser/table-core.cjs';
export const REVENUE_PARSER_VERSION = 'original-rows-v1';
export interface FilingDocument {
  metadata: FilingMetadata;
  html: string;
}
@Injectable()
export class RevenueService {
  private readonly logger = new Logger(RevenueService.name);
  private readonly requests = new Map<string, Promise<unknown>>();
  constructor(
    private readonly db: PrismaService,
    private readonly sec: SecClient,
  ) {}
  private shared<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(key);
    if (existing) return existing as Promise<T>;
    const promise = work();
    this.requests.set(key, promise);
    void promise.then(
      () => {
        const timer = setTimeout(() => {
          if (this.requests.get(key) === promise) this.requests.delete(key);
        }, 20000);
        timer.unref();
      },
      () => {
        if (this.requests.get(key) === promise) this.requests.delete(key);
      },
    );
    return promise;
  }
  metadata(cik: string) {
    return this.shared(`metadata:${cik}`, async () =>
      latest10K(
        await this.sec.getJson(
          `https://data.sec.gov/submissions/CIK${cik}.json`,
        ),
        cik,
      ),
    );
  }
  html(metadata: FilingMetadata) {
    return this.shared(`html:${metadata.sourceUrl}`, () =>
      this.sec.getText(metadata.sourceUrl),
    );
  }
  private serialize(
    row: RevenueBreakdownCache | null,
  ): RevenueBreakdownResponse {
    return {
      status: row?.status ?? 'NOT_FETCHED',
      accessionNumber: row?.accessionNumber ?? null,
      sourceUrl: row?.sourceUrl ?? null,
      fiscalYear: row?.fiscalYear ?? null,
      extractedAt: row?.extractedAt?.toISOString() ?? null,
      groups: (row?.data ?? []) as unknown as RevenueGroup[],
    };
  }
  async ensure(
    cik: string,
    refresh = false,
    supplied?: FilingDocument,
  ): Promise<RevenueBreakdownResponse> {
    if (
      !(await this.db.company.findUnique({
        where: { cik },
        select: { cik: true },
      }))
    )
      throw new NotFoundException('请先读取公司详情');
    let current = await this.db.revenueBreakdownCache.findUnique({
      where: { companyCik: cik },
    });
    if (!refresh && current?.checkedAt) return this.serialize(current);
    await this.db.revenueBreakdownCache.createMany({
      data: [{ companyCik: cik }],
      skipDuplicates: true,
    });
    const token = randomUUID();
    const claim = await this.db.revenueBreakdownCache.updateMany({
      where: {
        companyCik: cik,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
        ...(!refresh ? { checkedAt: null } : {}),
      },
      data: { fetchToken: token, leaseUntil: new Date(Date.now() + 300000) },
    });
    if (!claim.count)
      return this.serialize(
        await this.db.revenueBreakdownCache.findUnique({
          where: { companyCik: cik },
        }),
      );
    try {
      // Another request may have completed between the initial read and lease claim.
      current = await this.db.revenueBreakdownCache.findUnique({
        where: { companyCik: cik },
      });
      const metadata = supplied?.metadata ?? (await this.metadata(cik));
      if (
        current?.accessionNumber === metadata.accessionNumber &&
        current.parserVersion === REVENUE_PARSER_VERSION &&
        current.extractedAt
      ) {
        await this.db.revenueBreakdownCache.updateMany({
          where: { companyCik: cik, fetchToken: token },
          data: {
            fetchToken: null,
            leaseUntil: null,
            checkedAt: new Date(),
            lastError: null,
          },
        });
        return this.serialize(current);
      }
      const html = supplied?.html ?? (await this.html(metadata));
      const $ = load(html, { xmlMode: true });
      const dei = (name: string) =>
        $('*')
          .toArray()
          .filter(
            (n) =>
              n.type === 'tag' &&
              /^\{http:\/\/xbrl.sec.gov\/dei\/\d{4}\}/.test(
                qname(n, n.attribs.name ?? '') ?? '',
              ) &&
              n.attribs.name?.split(':')[1] === name,
          )
          .map((n) => $(n).text().trim());
      if (
        !dei('DocumentType').includes('10-K') ||
        !dei('DocumentPeriodEndDate').some((date) =>
          [
            metadata.reportDate,
            new Intl.DateTimeFormat('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(metadata.reportDate)),
          ].includes(date.replace(/\s+/g, ' ')),
        ) ||
        !dei('EntityCentralIndexKey').some(
          (id) => /^\d+$/.test(id) && id.padStart(10, '0') === cik,
        )
      )
        throw new Error('filing document identity mismatch');
      const parsed = extractTables(html, { ...metadata, cik });
      for (const group of parsed.groups)
        for (const row of group.rows) {
          if (
            new Set(row.facts.map((f) => f.fiscalYear)).size !==
            row.facts.length
          )
            throw new Error('ambiguous fiscal periods');
          for (const f of row.facts)
            if (!/^-?\d+$/.test(f.value))
              throw new Error('invalid exact amount');
        }
      const now = new Date();
      // One guarded SQL UPDATE atomically commits the entire result, including EMPTY.
      await this.db.revenueBreakdownCache.updateMany({
        where: { companyCik: cik, fetchToken: token, leaseUntil: { gt: now } },
        data: {
          status: parsed.groups.length ? 'READY' : 'EMPTY',
          accessionNumber: metadata.accessionNumber,
          sourceUrl: metadata.sourceUrl,
          fiscalYear: metadata.fiscalYear,
          reportDate: metadata.reportDate,
          parserVersion: REVENUE_PARSER_VERSION,
          data: JSON.parse(
            JSON.stringify(parsed.groups),
          ) as Prisma.InputJsonValue,
          extractedAt: now,
          checkedAt: now,
          fetchToken: null,
          leaseUntil: null,
          lastError: null,
        },
      });
    } catch {
      this.logger.warn(
        `Revenue breakdown extraction failed for CIK ${cik}; retaining cached data`,
      );
      await this.db.revenueBreakdownCache.updateMany({
        where: { companyCik: cik, fetchToken: token },
        data: {
          ...(!current?.extractedAt ? { status: 'FAILED' } : {}),
          checkedAt: new Date(),
          fetchToken: null,
          leaseUntil: null,
          lastError: '收入明细暂不可用，可通过更新数据重试',
        },
      });
    }
    return this.serialize(
      await this.db.revenueBreakdownCache.findUnique({
        where: { companyCik: cik },
      }),
    );
  }
}
