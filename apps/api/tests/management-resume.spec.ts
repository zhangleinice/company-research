import { generateText } from 'ai';
import { ConfigService } from '@nestjs/config';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';
import { SummaryModel } from '../src/modules/ai-research/summary-model';
import { TOPICS } from '../src/modules/ai-research/summary-schema';
import { emptyCapitalInformation } from '../src/modules/ai-research/capital-information';
import type { GenerationCheckpointData } from '../src/modules/ai-research/generation-checkpoint';
jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { json: () => ({}) },
  APICallError: { isInstance: () => false },
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => ({}) }),
}));
const filing = {
  id: 'cached-filing',
  companyCik: '0000000001',
  accessionNumber: 'cached-accession',
  parserVersion: 'items-v2',
  filingType: '10-K',
  fiscalYear: 2025,
  filingDate: '2026-02-01',
  reportDate: '2025-12-31',
  sourceUrl: 'https://www.sec.gov/Archives/test.htm',
  sections: {
    'Item 7': [
      { id: 'Item 7:p1', text: 'Infrastructure investment. '.repeat(530) },
      { id: 'Item 7:p2', text: 'Operating conditions. '.repeat(780) },
    ],
  },
};
const response = () => ({
  output: {
    groups: TOPICS.mda.map((topic) => ({ topic, findings: [] })),
    capitalAllocation: emptyCapitalInformation(),
  },
  usage: { inputTokens: 11, outputTokens: 7 },
  response: { modelId: 'mock' },
  finishReason: 'stop',
});
function fixture() {
  const task = {
    id: '0000000001:Item 7:whole-item',
    token: null as string | null,
    status: 'FAILED',
    leaseUntil: new Date(0),
    progress: {} as unknown,
    error: null as string | null,
  };
  const old = {
    summaryJson: { groups: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    promptVersion: 'old',
  };
  let published: unknown = old;
  let failCommit = false;
  let publications = 0;
  const apply = (
    row: typeof task,
    {
      where,
      data,
    }: {
      where: {
        token?: string;
        status?: string;
        leaseUntil?: { gt?: Date; lte?: Date };
      };
      data: Partial<typeof task>;
    },
  ) => {
    if (
      (where.token !== undefined && where.token !== row.token) ||
      (where.status && where.status !== row.status) ||
      (where.leaseUntil?.gt && row.leaseUntil <= where.leaseUntil.gt) ||
      (where.leaseUntil?.lte && row.leaseUntil > where.leaseUntil.lte)
    )
      return { count: 0 };
    Object.assign(row, structuredClone(data));
    return { count: 1 };
  };
  const db = {
    company: {
      findUniqueOrThrow: jest.fn(async () => ({
        cik: filing.companyCik,
        ticker: 'TEST',
        name: 'Test',
      })),
      upsert: jest.fn(),
    },
    aiTask: {
      upsert: jest.fn(),
      updateMany: jest.fn(async (args) => apply(task, args)),
      findUnique: jest.fn(async () => structuredClone(task)),
    },
    aiSummary: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => published),
    },
    $transaction: jest.fn(async (callback) => {
      const draft = structuredClone(task);
      let candidate = published;
      const result = await callback({
        aiTask: {
          updateMany: async (args: Parameters<typeof apply>[1]) =>
            apply(draft, args),
        },
        aiSummary: {
          upsert: async ({ create }: { create: object }) => {
            candidate = {
              ...create,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return candidate;
          },
        },
      });
      if (failCommit) {
        failCommit = false;
        throw new Error('Mock commit failed');
      }
      Object.assign(task, draft);
      published = candidate;
      publications++;
      return result;
    }),
  };
  const client = { getJson: jest.fn(), getText: jest.fn() };
  const service = new AiResearchService(
    db as never,
    {} as never,
    client as never,
    new SummaryModel(
      new ConfigService({
        ROUTER_API_KEY: 'mock-only',
        AI_ITEM_LIMITS_JSON: JSON.stringify({
          model: 'gpt-6.1-sol',
          provider: 'https://api.router.ai/v1',
          contextWindow: 128000,
          maxInputTokens: 64000,
          maxOutputTokens: 32000,
          byteFallbackTokenizer: true,
          source: 'Mock verified profile',
        }),
      }),
    ),
  );
  return {
    task,
    old,
    client,
    service,
    read: () => published,
    publications: () => publications,
    failCommit: () => {
      failCommit = true;
    },
    run: () => service.generateItem('TEST', 'Item 7', true, filing as never),
  };
}
beforeEach(() => jest.mocked(generateText).mockReset());
it('commit rollback preserves prior official summary; explicit force reuses whole-Item checkpoint with zero new AI calls', async () => {
  const f = fixture();
  jest.mocked(generateText).mockResolvedValue(response() as never);
  f.failCommit();
  await expect(f.run()).rejects.toThrow('Mock commit failed');
  expect(f.read()).toBe(f.old);
  expect(f.task.status).toBe('FAILED');
  expect(
    (f.task.progress as GenerationCheckpointData).steps['whole-item'].status,
  ).toBe('succeeded');
  jest.mocked(generateText).mockClear();
  const result = await f.run();
  expect(generateText).not.toHaveBeenCalled();
  expect(result.status).toBe('READY');
  expect(f.publications()).toBe(1);
  expect(f.client.getJson).not.toHaveBeenCalled();
  expect(f.client.getText).not.toHaveBeenCalled();
});
it('concurrent explicit worker cannot acquire live task; passive API hides successful chunks until atomic publication', async () => {
  const f = fixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const entered = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  jest
    .mocked(generateText)
    .mockImplementationOnce(async () => {
      arrived();
      await waiting;
      return response() as never;
    })
    .mockResolvedValue(response() as never);
  const running = f.run();
  await entered;
  expect(
    (f.task.progress as GenerationCheckpointData).steps['whole-item'].status,
  ).toBe('pending');
  await expect(f.run()).rejects.toThrow('正在生成');
  const state = await f.service.state(filing.companyCik, 'mda');
  expect(state.status).toBe('GENERATING');
  expect(state.summary?.summaryJson).toEqual(f.old.summaryJson);
  expect(state).not.toHaveProperty('progress');
  expect(f.publications()).toBe(0);
  release();
  await running;
  expect(f.publications()).toBe(1);
});
it('ownership takeover during response prevents old worker checkpoint, failure status, or final publication writes', async () => {
  const f = fixture();
  jest.mocked(generateText).mockImplementationOnce(async () => {
    f.task.token = 'new-worker';
    return response() as never;
  });
  await expect(f.run()).rejects.toThrow('租约');
  expect(f.task.token).toBe('new-worker');
  expect(f.task.status).toBe('GENERATING');
  expect(f.publications()).toBe(0);
  expect(f.read()).toBe(f.old);
  expect(
    (f.task.progress as GenerationCheckpointData).steps['whole-item'].status,
  ).not.toBe('succeeded');
});
