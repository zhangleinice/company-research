import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type {
  CompanyUpdateProgress,
  CompanyUpdateState,
  UpdateStage,
} from '@company-research/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import { AiResearchService } from './ai-research.service';
import {
  PROMPT_VERSION,
  BUSINESS_PROMPT_VERSION,
  MANAGEMENT_PROMPT_VERSION,
} from './summary-model';
const json = (v: unknown) => v as Prisma.InputJsonValue;
const lease = () => new Date(Date.now() + 300000);
const active = ['QUEUED', 'GENERATING'];
@Injectable()
export class CompanyUpdateService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyService,
    private readonly ai: AiResearchService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick().catch(() => undefined),
      1000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async state(cik: string): Promise<CompanyUpdateState> {
    const task = await this.db.aiTask.findUnique({
      where: { id: `${cik}:update` },
    });
    if (!task)
      return { status: 'IDLE', updatedAt: null, error: null, progress: null };
    if (task.status === 'GENERATING' && task.leaseUntil <= new Date()) {
      await this.db.aiTask.updateMany({
        where: {
          id: task.id,
          token: task.token,
          leaseUntil: { lte: new Date() },
          status: 'GENERATING',
        },
        data: {
          status: 'FAILED',
          error: '任务中断或超时；保留已有数据，请手动更新',
          token: null,
        },
      });
      return this.state(cik);
    }
    return {
      status: task.status as CompanyUpdateState['status'],
      updatedAt: task.updatedAt.toISOString(),
      error: task.error,
      progress: task.progress as unknown as CompanyUpdateProgress,
    };
  }
  async start(cik: string, mode: 'FULL' | 'INITIAL') {
    const company = await this.db.company.findUnique({ where: { cik } });
    if (!company) throw new NotFoundException('请先读取公司详情');
    const id = `${cik}:update`;
    if (mode === 'INITIAL') {
      const summaries = await this.db.aiSummary.findMany({
        where: {
          companyCik: cik,
          OR: [
            {
              section: 'business',
              promptVersion: { in: [PROMPT_VERSION, BUSINESS_PROMPT_VERSION] },
            },
            {
              section: 'management',
              promptVersion: {
                in: [PROMPT_VERSION, MANAGEMENT_PROMPT_VERSION],
              },
            },
          ],
        },
        select: { section: true },
      });
      if (new Set(summaries.map((x) => x.section)).size === 2)
        return this.state(cik);
      const previous = await this.db.aiTask.findUnique({ where: { id } });
      // Automatic paid initialization is attempted only once, even after failures/restarts.
      if (previous) return this.state(cik);
    }
    const progress: CompanyUpdateProgress = {
      mode,
      stages: {
        financials: { status: mode === 'FULL' ? 'PENDING' : 'SKIPPED' },
        filing: { status: 'PENDING' },
        business: { status: 'PENDING' },
        management: { status: 'PENDING' },
      },
    };
    const inserted = await this.db.aiTask.createMany({
      data: [
        {
          id,
          companyCik: cik,
          section: 'company-update',
          status: 'IDLE',
          leaseUntil: new Date(0),
        },
      ],
      skipDuplicates: true,
    });
    if (mode === 'INITIAL' && !inserted.count) return this.state(cik);
    await this.state(cik); // Mark expired work failed before allowing an explicit retry.
    const claimed = await this.db.aiTask.updateMany({
      where: { id, status: { notIn: active } },
      data: {
        status: 'QUEUED',
        token: randomUUID(),
        leaseUntil: lease(),
        progress: json(progress),
        error: null,
      },
    });
    // Return the already-running task instead of enqueueing a duplicate.
    if (!claimed.count) return this.state(cik);
    return this.state(cik);
  }
  async tick() {
    if (this.working) return;
    this.working = true;
    try {
      const task = await this.db.aiTask.findFirst({
        where: { section: 'company-update', status: 'QUEUED' },
        orderBy: { updatedAt: 'asc' },
      });
      if (!task) return;
      const claimed = await this.db.aiTask.updateMany({
        where: { id: task.id, token: task.token, status: 'QUEUED' },
        data: { status: 'GENERATING', leaseUntil: lease() },
      });
      if (!claimed.count) return;
      await this.run(
        task.id,
        task.companyCik,
        task.token!,
        task.progress as unknown as CompanyUpdateProgress,
      );
    } finally {
      this.working = false;
    }
  }
  private async run(
    id: string,
    cik: string,
    token: string,
    progress: CompanyUpdateProgress,
  ) {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.db.aiTask
        .updateMany({
          where: { id, token, status: 'GENERATING' },
          data: { leaseUntil: lease() },
        })
        .then((x) => {
          if (!x.count) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, 30000);
    heartbeat.unref();
    const save = async () => {
      if (leaseLost) throw new ConflictException('更新任务租约失效');
      const changed = await this.db.aiTask.updateMany({
        where: { id, token, status: 'GENERATING' },
        data: { progress: json(progress), leaseUntil: lease() },
      });
      if (!changed.count) throw new ConflictException('更新任务租约失效');
    };
    const stage = async <T>(key: UpdateStage, work: () => Promise<T>) => {
      progress.stages[key] = {
        status: 'RUNNING',
        updatedAt: new Date().toISOString(),
      };
      await save();
      try {
        const result = await work();
        progress.stages[key] = {
          status: 'SUCCESS',
          updatedAt: new Date().toISOString(),
        };
        await save();
        return result;
      } catch (e) {
        progress.stages[key] = {
          status: 'FAILED',
          error: e instanceof Error ? e.message.slice(0, 300) : '更新失败',
          updatedAt: new Date().toISOString(),
        };
        await save();
        return undefined;
      }
    };
    try {
      if (progress.mode === 'FULL')
        await stage('financials', async () => {
          const detail = await this.companies.getCompany(cik, true);
          if (detail.financialStatus !== 'READY')
            throw new Error('财务数据仍在其他任务中获取，请稍后重试');
        });
      const filing = await stage('filing', () =>
        this.ai.prepareFiling(
          cik,
          progress.mode === 'FULL',
          progress.mode === 'INITIAL',
        ),
      );
      if (filing) {
        for (const kind of ['business', 'management'] as const) {
          await stage(kind, () =>
            this.ai.generate(cik, kind, progress.mode === 'FULL', filing),
          );
        }
      } else {
        progress.stages.business = {
          status: 'SKIPPED',
          error: '年报提取失败，保留原摘要',
        };
        progress.stages.management = {
          status: 'SKIPPED',
          error: '年报提取失败，保留原摘要',
        };
      }
      const stages = Object.values(progress.stages);
      const failed = stages.some((x) => x.status === 'FAILED');
      const status = failed
        ? stages.some((x) => x.status === 'SUCCESS')
          ? 'PARTIAL'
          : 'FAILED'
        : 'READY';
      await this.db.aiTask.updateMany({
        where: { id, token, status: 'GENERATING' },
        data: {
          status,
          progress: json(progress),
          error: failed ? '部分阶段更新失败，已有有效数据已保留' : null,
          leaseUntil: new Date(0),
          token: null,
        },
      });
    } catch {
      await this.db.aiTask.updateMany({
        where: { id, token },
        data: {
          status: 'FAILED',
          error: '任务中断，已有有效数据已保留',
          progress: json(progress),
          leaseUntil: new Date(0),
          token: null,
        },
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
