import { RevenueService } from '../revenue/revenue.service';
import {
  Injectable,
  Optional,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
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
  LEGACY_BUSINESS_PROMPT_VERSIONS,
  LEGACY_MANAGEMENT_PROMPT_VERSIONS,
  LEGACY_MDA_PROMPT_VERSIONS,
  promptVersionFor,
} from './summary-model';
import type { SummaryKind } from './summary-schema';
import {
  capitalEvidence,
  validateCapitalInformation,
} from './capital-information';
import type { CapitalAllocationInformation } from '@company-research/shared';

import { ManagementLease } from './management-lease';
import { composeManagement } from './compose-item-research';
import { ITEM_FOR, type ExtractionKind } from './item-extraction';
import type { Item } from './filing-parser';
import { WHOLE_ITEM_STRATEGY, wholeItemTaskId } from './whole-item-input';
import { digest } from './generation-checkpoint';

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
    if (section === 'management') {
      const [mda, risks, legacy] = await Promise.all([
        this.itemState(cik, 'mda'),
        this.itemState(cik, 'risks'),
        this.itemState(cik, 'management'),
      ]);
      const summary = composeManagement(
        mda.summary,
        risks.summary,
        legacy.summary,
      );
      const running = [mda, risks, legacy].some(
        (s) => s.status === 'GENERATING',
      );
      const failed =
        [mda, risks].some((s) => s.status === 'FAILED') ||
        (!mda.summary && !risks.summary && legacy.status === 'FAILED');
      return {
        status: running
          ? 'GENERATING'
          : failed
            ? 'FAILED'
            : summary
              ? 'READY'
              : 'NOT_GENERATED',
        error:
          [
            mda.error,
            risks.error,
            ...(!mda.summary && !risks.summary ? [legacy.error] : []),
          ]
            .filter(Boolean)
            .join('；') || null,
        summary: serialize(summary),
      };
    }
    const result = await this.itemState(cik, section);
    return { ...result, summary: serialize(result.summary) };
  }
  private async itemState(cik: string, section: SummaryKind) {
    const [currentSummary, task] = await Promise.all([
      this.db.aiSummary.findFirst({
        where: {
          companyCik: cik,
          section,
          promptVersion: promptVersionFor(section),
        },
        orderBy: [{ fiscalYear: 'desc' }, { updatedAt: 'desc' }],
      }),
      this.db.aiTask.findUnique({
        where: {
          id:
            section === 'management'
              ? `${cik}:management`
              : wholeItemTaskId(cik, ITEM_FOR[section]),
        },
      }),
    ]);
    const summary =
      currentSummary ??
      (section === 'risks'
        ? null
        : await this.db.aiSummary.findFirst({
            where: {
              companyCik: cik,
              section,
              promptVersion:
                section === 'business'
                  ? { in: [...LEGACY_BUSINESS_PROMPT_VERSIONS] }
                  : section === 'mda'
                    ? { in: [...LEGACY_MDA_PROMPT_VERSIONS] }
                    : { in: [...LEGACY_MANAGEMENT_PROMPT_VERSIONS] },
            },
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
      summary,
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
    if (section !== 'management')
      return this.generateItem(identifier, ITEM_FOR[section], force, prepared);
    // A passive/initial request may keep a complete legacy result. Explicit refresh generates independent Items.
    const company = prepared
      ? { cik: prepared.companyCik }
      : await this.sec.resolveCompany(identifier);
    if (!force) {
      const cached = await this.state(company.cik, 'management');
      if (
        cached.summary &&
        !(
          cached.summary.summaryJson as unknown as {
            unavailableItems?: string[];
          }
        ).unavailableItems?.length
      )
        return { ...cached, cached: true };
    }
    const filing = prepared ?? (await this.prepareFiling(company.cik));
    const failures: string[] = [];
    for (const item of ['Item 7', 'Item 1A'] as const) {
      try {
        await this.generateItem(company.cik, item, force, filing);
      } catch (e) {
        failures.push(
          `${item}：${e instanceof Error ? e.message : '生成失败'}`,
        );
      }
    }
    if (failures.length) throw new BadGatewayException(failures.join('；'));
    return { ...(await this.state(company.cik, 'management')), cached: false };
  }
  async generateItem(
    identifier: string,
    item: Item,
    force = false,
    prepared?: AiFiling,
  ) {
    const section: ExtractionKind =
      item === 'Item 1' ? 'business' : item === 'Item 7' ? 'mda' : 'risks';
    const company = prepared
      ? await this.db.company.findUniqueOrThrow({
          where: { cik: prepared.companyCik },
        })
      : await this.sec.resolveCompany(identifier);
    const cik = company.cik,
      id = wholeItemTaskId(cik, item),
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
      if (lease) return lease.renew();
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
    const lease = new ManagementLease(this.db, id, token);
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
      let cached = await this.db.aiSummary.findUnique({ where });
      if (!cached && !force && section === 'business') {
        const versions = LEGACY_BUSINESS_PROMPT_VERSIONS;
        for (const version of versions) {
          cached = await this.db.aiSummary.findUnique({
            where: {
              companyCik_accessionNumber_section_promptVersion: {
                ...where.companyCik_accessionNumber_section_promptVersion,
                promptVersion: version,
              },
            },
          });
          if (cached) break;
        }
      }
      if (cached && !force) {
        await lease?.settle();
        const released = await this.db.aiTask.updateMany({
          where: {
            id,
            token,
            ...(lease
              ? { status: 'GENERATING', leaseUntil: { gt: new Date() } }
              : {}),
          },
          data: { status: 'READY', leaseUntil: new Date(0), token: null },
        });
        if (!released.count) throw new ConflictException('任务租约已失效');
        return {
          status: 'READY',
          error: null,
          summary: serialize(cached),
          cached: true,
        };
      }
      const filing = prepared ?? (await this.prepareFiling(cik));
      if (
        filing.companyCik !== cik ||
        filing.accessionNumber !== metadata.accessionNumber
      )
        throw new ConflictException(
          '准备期间申报身份变化，未调用AI；请重新明确执行',
        );
      const sections = filing.sections as unknown as Sections;
      const originals = sections[item];
      const paragraphs = originals.map((p) => ({ ...p }));
      const execution = lease
        ? {
            source: {
              cik,
              filingId: filing.id,
              accessionNumber: filing.accessionNumber,
              parserVersion: filing.parserVersion,
              inputHash: digest(originals),
              item,
            },
            checkpoint: lease,
            signal: lease.signal,
          }
        : undefined;
      const { summary, usage, modelId } = execution
        ? await this.model.generate(section, paragraphs, renew, execution)
        : await this.model.generate(section, paragraphs, renew);
      const capital =
        'capitalAllocation' in summary
          ? (summary.capitalAllocation as
              CapitalAllocationInformation | undefined)
          : undefined;
      if (section === 'mda' && !capital)
        throw new BadGatewayException(
          '新版管理层结果缺少资本配置字段，保留旧结果',
        );
      if (section === 'mda' && capital) {
        validateCapitalInformation(capital, paragraphs);
        const ids = new Set(capitalEvidence(capital).map((e) => e.paragraphId));
        capital.source = {
          filingId: filing.id,
          cik,
          accessionNumber: filing.accessionNumber,
          filingType: filing.filingType,
          fiscalYear: filing.fiscalYear,
          reportDate: filing.reportDate,
          filingDate: filing.filingDate,
          sourceUrl: filing.sourceUrl,
          item: 'Item 7',
          parserVersion: filing.parserVersion,
          inputHash: createHash('sha256')
            .update(JSON.stringify(sections['Item 7']))
            .digest('hex'),
          evidenceParagraphs: paragraphs
            .filter((p) => ids.has(p.id))
            .map((p) => ({ ...p })),
        };
      }
      const evidenceIds = new Set(
        summary.groups.flatMap((g) =>
          g.findings.flatMap((f) => f.evidence.map((e) => e.paragraphId)),
        ),
      );
      if (capital)
        for (const evidence of capitalEvidence(capital))
          evidenceIds.add(evidence.paragraphId);
      summary.extraction = {
        strategy: WHOLE_ITEM_STRATEGY,
        item,
        filingId: filing.id,
        cik,
        accessionNumber: filing.accessionNumber,
        parserVersion: filing.parserVersion,
        inputHash: digest(originals),
        language: 'zh-CN',
        evidenceParagraphs: paragraphs
          .filter((p) => evidenceIds.has(p.id))
          .map((p) => ({ ...p })),
      };
      await lease?.settle();
      const row = await this.db.$transaction(async (tx) => {
        const held = await tx.aiTask.updateMany({
          where: {
            id,
            token,
            status: 'GENERATING',
            leaseUntil: { gt: new Date() },
          },
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
        where: {
          id,
          token,
          ...(lease
            ? { status: 'GENERATING', leaseUntil: { gt: new Date() } }
            : {}),
        },
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
    } finally {
      await lease?.dispose();
    }
  }
}
