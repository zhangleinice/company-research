import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import type { CheckpointIO } from './generation-checkpoint';
export const MANAGEMENT_LEASE_MS = 300000;
export const MANAGEMENT_HEARTBEAT_MS = 30000;
/** All child-task writes are fenced by ownership, status and a live lease. */
export class ManagementLease implements CheckpointIO {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  readonly signal = this.controller.signal;
  constructor(
    private readonly db: PrismaService,
    private readonly id: string,
    private readonly token: string,
  ) {
    this.timer = setInterval(() => {
      if (this.pending || this.signal.aborted) return;
      this.pending = this.renew()
        .catch(() => undefined)
        .finally(() => {
          this.pending = undefined;
        });
    }, MANAGEMENT_HEARTBEAT_MS);
    this.timer.unref();
  }
  private where() {
    return {
      id: this.id,
      token: this.token,
      status: 'GENERATING',
      leaseUntil: { gt: new Date() },
    };
  }
  private lost() {
    const e = new ConflictException(
      'Management任务租约已失效，旧worker停止执行',
    );
    if (!this.signal.aborted) this.controller.abort(e);
    return e;
  }
  private active() {
    if (this.signal.aborted) throw this.signal.reason;
  }
  async renew() {
    this.active();
    try {
      const updated = await this.db.aiTask.updateMany({
        where: this.where(),
        data: { leaseUntil: new Date(Date.now() + MANAGEMENT_LEASE_MS) },
      });
      if (!updated.count) throw this.lost();
    } catch {
      throw this.lost();
    }
  }
  async load() {
    await this.renew();
    const task = await this.db.aiTask.findUnique({ where: { id: this.id } });
    if (
      !task ||
      task.token !== this.token ||
      task.status !== 'GENERATING' ||
      task.leaseUntil <= new Date()
    )
      throw this.lost();
    return task.progress;
  }
  async save(value: unknown) {
    this.active();
    const updated = await this.db.aiTask.updateMany({
      where: this.where(),
      data: {
        progress: value as Prisma.InputJsonValue,
        leaseUntil: new Date(Date.now() + MANAGEMENT_LEASE_MS),
      },
    });
    if (!updated.count) throw this.lost();
  }
  /** Stop heartbeats before the short publication transaction, then verify ownership. */
  async settle() {
    await this.dispose();
    await this.renew();
  }
  async dispose() {
    clearInterval(this.timer);
    await this.pending;
  }
}
