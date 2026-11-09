import { CompanyUpdateService } from '../src/modules/ai-research/company-update.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import type { CompanyService } from '../src/modules/company/company.service';
import type { AiResearchService } from '../src/modules/ai-research/ai-research.service';
import type { CompanyUpdateProgress } from '@company-research/shared';

function setup() {
  let task: Record<string, unknown> | null = null;
  const db = {
    company: { findUnique: jest.fn().mockResolvedValue({ cik: '0001652044' }) },
    aiSummary: { findMany: jest.fn().mockResolvedValue([]) },
    aiTask: {
      findUnique: jest.fn(async () => task),
      createMany: jest.fn(async ({ data }) => {
        if (task) return { count: 0 };
        task = { ...data[0], progress: {}, updatedAt: new Date(), token: null };
        return { count: 1 };
      }),
      findFirst: jest.fn(async () => (task?.status === 'QUEUED' ? task : null)),
      updateMany: jest.fn(async ({ where, data }) => {
        if (
          !task ||
          (where.status &&
            (typeof where.status === 'string'
              ? task.status !== where.status
              : where.status.notIn?.includes(task.status))) ||
          (where.token !== undefined && where.token !== task.token)
        )
          return { count: 0 };
        task = { ...task, ...data, updatedAt: new Date() };
        return { count: 1 };
      }),
    },
  };
  const companies = {
    getCompany: jest.fn().mockResolvedValue({ financialStatus: 'READY' }),
  };
  const ai = {
    prepareFiling: jest
      .fn()
      .mockResolvedValue({ accessionNumber: 'new-filing' }),
    generate: jest.fn().mockResolvedValue({ status: 'READY' }),
  };
  const service = new CompanyUpdateService(
    db as unknown as PrismaService,
    companies as unknown as CompanyService,
    ai as unknown as AiResearchService,
  );
  return { service, db, companies, ai, task: () => task };
}
describe('unified company background update', () => {
  it('acknowledges immediately and coalesces duplicate requests before paid work', async () => {
    const { service, ai, companies } = setup();
    const states = await Promise.all([
      service.start('0001652044', 'FULL'),
      service.start('0001652044', 'FULL'),
    ]);
    expect(states.every((s) => s.status === 'QUEUED')).toBe(true);
    expect(ai.generate).not.toHaveBeenCalled();
    await service.tick();
    expect(companies.getCompany).toHaveBeenCalledTimes(1);
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(ai.prepareFiling).toHaveBeenCalledWith('0001652044', true, false);
    expect((await service.state('0001652044')).status).toBe('READY');
  });
  it('preserves financial success and independently records failed AI', async () => {
    const { service, ai, task } = setup();
    ai.generate.mockRejectedValueOnce(new Error('AI invalid JSON'));
    await service.start('0001652044', 'FULL');
    await service.tick();
    expect(task()?.status).toBe('PARTIAL');
    const p = task()?.progress as CompanyUpdateProgress;
    expect(p.stages.financials.status).toBe('SUCCESS');
    expect(p.stages.business.status).toBe('FAILED');
    expect(p.stages.management.status).toBe('SUCCESS');
  });
  it('never calls AI with old filing when new extraction fails', async () => {
    const { service, ai, task } = setup();
    ai.prepareFiling.mockRejectedValue(new Error('invalid sections'));
    await service.start('0001652044', 'FULL');
    await service.tick();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(task()?.status).toBe('PARTIAL');
  });
  it('does no SEC/AI work on cached initialization and status reads', async () => {
    const { service, db, ai, companies } = setup();
    db.aiSummary.findMany.mockResolvedValue([
      { section: 'business' },
      { section: 'management' },
    ] as never);
    expect((await service.start('0001652044', 'INITIAL')).status).toBe('IDLE');
    await service.state('0001652044');
    await service.tick();
    expect(ai.prepareFiling).not.toHaveBeenCalled();
    expect(companies.getCompany).not.toHaveBeenCalled();
  });
  it('attempts automatic initialization only once, including after failure', async () => {
    const { service, ai, companies } = setup();
    ai.prepareFiling.mockRejectedValue(new Error('SEC unavailable'));
    await Promise.all([
      service.start('0001652044', 'INITIAL'),
      service.start('0001652044', 'INITIAL'),
    ]);
    await service.tick();
    await service.start('0001652044', 'INITIAL');
    await service.tick();
    expect(ai.prepareFiling).toHaveBeenCalledTimes(1);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(companies.getCompany).not.toHaveBeenCalled();
    expect((await service.state('0001652044')).status).toBe('FAILED');
  });
});
