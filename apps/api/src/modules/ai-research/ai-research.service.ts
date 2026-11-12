import { RevenueService } from '../revenue/revenue.service';
import {
  Injectable,
  Optional,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, AiSummary, AiFiling } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecService } from '../sec/sec.service';
import { SecClient } from '../sec/sec.client';
import {
  extractSections,
  latest10K,
  PARSER_VERSION,
  type Sections,
} from './filing-parser';
import {
  SummaryModel,
  MODEL,
  PROMPT_VERSION,
  promptVersionFor,
} from './summary-model';
import type { SummaryKind } from './summary-schema';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const serialize = (row: AiSummary | null) =>
  row && {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
@Injectable()
export class AiResearchService {
  constructor(
    private readonly db: PrismaService,
    private readonly sec: SecService,
    private readonly client: SecClient,
    private readonly model: SummaryModel,
    @Optional() private readonly revenue?: RevenueService,
  ) {}
  async state(cik: string, section: SummaryKind) {
    const [currentSummary, task] = await Promise.all([
      this.db.aiSummary.findFirst({
        where: {
          companyCik: cik,
          section,
          promptVersion: promptVersionFor(section),
        },
        orderBy: [{ fiscalYear: 'desc' }, { updatedAt: 'desc' }],
      }),
      this.db.aiTask.findUnique({ where: { id: `${cik}:${section}` } }),
    ]);
    const summary =
      currentSummary ??
      (await this.db.aiSummary.findFirst({
        where: { companyCik: cik, section, promptVersion: PROMPT_VERSION },
        orderBy: [{ fiscalYear: 'desc' }, { updatedAt: 'desc' }],
      }));
    const running =
      task?.status === 'GENERATING' && task.leaseUntil > new Date();
    const expired = task?.status === 'GENERATING' && !running;
    return {
      status: running
        ? 'GENERATING'
        : expired || task?.status === 'FAILED'
          ? 'FAILED'
          : summary
            ? 'READY'
            : 'NOT_GENERATED',
      error: expired
        ? '上次任务已超时，可重试；可能已产生费用'
        : (task?.error ?? null),
      summary: serialize(summary),
    };
  }
  async prepareFiling(
    cik: string,
    refresh = false,
    preferCache = false,
  ): Promise<AiFiling> {
    if (preferCache) {
      const cached = await this.db.aiFiling.findFirst({
        where: { companyCik: cik, parserVersion: PARSER_VERSION },
        orderBy: { reportDate: 'desc' },
      });
      if (cached) return cached;
    }
    const metadata = this.revenue
      ? await this.revenue.metadata(cik)
      : latest10K(
          await this.client.getJson(
            `https://data.sec.gov/submissions/CIK${cik}.json`,
          ),
          cik,
        );
    const where = {
      companyCik_accessionNumber_parserVersion: {
        companyCik: cik,
        accessionNumber: metadata.accessionNumber,
        parserVersion: PARSER_VERSION,
      },
    };
    const cached = await this.db.aiFiling.findUnique({ where });
    if (cached && !refresh) return cached;
    let sections: Sections;
    try {
      const html = this.revenue
        ? await this.revenue.html(metadata)
        : await this.client.getText(metadata.sourceUrl);
      if (this.revenue)
        await this.revenue
          .ensure(cik, true, { metadata, html })
          .catch(() => undefined);
      sections = extractSections(html);
    } catch (error) {
      throw new BadGatewayException(
        error instanceof Error ? error.message : '10-K 提取失败',
      );
    }
    const data = {
      ...metadata,
      companyCik: cik,
      parserVersion: PARSER_VERSION,
      sections: json(sections),
    };
    return this.db.aiFiling.upsert({ where, create: data, update: data });
  }
  async generate(
    identifier: string,
    section: SummaryKind,
    force: boolean,
    prepared?: AiFiling,
  ) {
    const company = prepared
      ? await this.db.company.findUniqueOrThrow({
          where: { cik: prepared.companyCik },
        })
      : await this.sec.resolveCompany(identifier);
    const cik = company.cik,
      id = `${cik}:${section}`,
      token = randomUUID();
    await this.db.company.upsert({
      where: { cik },
      create: { cik, ticker: company.ticker, name: company.name },
      update: {},
    });
    await this.db.aiTask.upsert({
      where: { id },
      create: {
        id,
        companyCik: cik,
        section,
        status: 'NOT_GENERATED',
        leaseUntil: new Date(0),
      },
      update: {},
    });
    const renew = async () => {
      const updated = await this.db.aiTask.updateMany({
        where: { id, token },
        data: { leaseUntil: new Date(Date.now() + 300000) },
      });
      if (!updated.count) throw new ConflictException('任务租约已失效');
    };
    const acquired = await this.db.aiTask.updateMany({
      where: { id, leaseUntil: { lte: new Date() } },
      data: {
        token,
        status: 'GENERATING',
        error: null,
        leaseUntil: new Date(Date.now() + 300000),
      },
    });
    if (!acquired.count)
      throw new ConflictException(
        '该模块正在生成，请等待完成；不会启动重复任务',
      );
    try {
      const metadata = prepared
        ? {
            accessionNumber: prepared.accessionNumber,
            fiscalYear: prepared.fiscalYear,
            filingDate: prepared.filingDate,
            reportDate: prepared.reportDate,
            sourceUrl: prepared.sourceUrl,
          }
        : latest10K(
            await this.client.getJson(
              `https://data.sec.gov/submissions/CIK${cik}.json`,
            ),
            cik,
          );
      const where = {
        companyCik_accessionNumber_section_promptVersion: {
          companyCik: cik,
          accessionNumber: metadata.accessionNumber,
          section,
          promptVersion: promptVersionFor(section),
        },
      };
      const cached =
        (await this.db.aiSummary.findUnique({ where })) ??
        (!force
          ? await this.db.aiSummary.findUnique({
              where: {
                companyCik_accessionNumber_section_promptVersion: {
                  ...where.companyCik_accessionNumber_section_promptVersion,
                  promptVersion: PROMPT_VERSION,
                },
              },
            })
          : null);
      if (cached && !force) {
        await this.db.aiTask.updateMany({
          where: { id, token },
          data: { status: 'READY', leaseUntil: new Date(0), token: null },
        });
        return {
          status: 'READY',
          error: null,
          summary: serialize(cached),
          cached: true,
        };
      }
      const filing = prepared ?? (await this.prepareFiling(cik));
      const sections = filing.sections as unknown as Sections;
      const originals =
        section === 'business'
          ? sections['Item 1']
          : [...sections['Item 7'], ...sections['Item 1A']];
      const paragraphs = originals.flatMap((p) => {
        if (p.text.length <= 18000) return [p];
        return Array.from(
          { length: Math.ceil(p.text.length / 18000) },
          (_, i) => ({
            id: `${p.id}:part${i + 1}`,
            text: p.text.slice(i * 18000, (i + 1) * 18000),
          }),
        );
      });
      const { summary, usage, modelId } = await this.model.generate(
        section,
        paragraphs,
        renew,
      );
      const row = await this.db.$transaction(async (tx) => {
        const held = await tx.aiTask.updateMany({
          where: { id, token, leaseUntil: { gt: new Date() } },
          data: { status: 'READY', leaseUntil: new Date(0), token: null },
        });
        if (!held.count) throw new ConflictException('任务过期，摘要未保存');
        const data = {
          ...metadata,
          companyCik: cik,
          section,
          model: modelId ?? MODEL,
          promptVersion: promptVersionFor(section),
          summaryJson: json(summary),
          usage: json(usage),
        };
        // reportDate belongs to filing metadata, not summary storage.
        const { reportDate: _reportDate, ...stored } = data;
        void _reportDate;
        return tx.aiSummary.upsert({ where, create: stored, update: stored });
      });
      return {
        status: 'READY',
        error: null,
        summary: serialize(row),
        cached: false,
      };
    } catch (error) {
      await this.db.aiTask.updateMany({
        where: { id, token },
        data: {
          status: 'FAILED',
          error:
            error instanceof Error
              ? error.message.slice(0, 350)
              : '摘要生成失败',
          leaseUntil: new Date(0),
          token: null,
        },
      });
      throw error;
    }
  }
}
