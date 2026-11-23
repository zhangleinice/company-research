import { ConfigService } from '@nestjs/config';
import { generateText } from 'ai';
import {
  ITEM_FOR,
  itemParagraphs,
  planItem,
  type ExtractionKind,
} from '../src/modules/ai-research/item-extraction';
import { SummaryModel } from '../src/modules/ai-research/summary-model';
import {
  TOPICS,
  validateItemSummary,
} from '../src/modules/ai-research/summary-schema';
import { emptyCapitalInformation } from '../src/modules/ai-research/capital-information';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';
import { composeManagement } from '../src/modules/ai-research/compose-item-research';
import { digest } from '../src/modules/ai-research/generation-checkpoint';
jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { json: () => ({}) },
  APICallError: { isInstance: () => false },
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => ({}) }),
}));
const provider = 'https://mock-router.example/v1';
const profile = {
  model: 'mock-model',
  provider,
  contextWindow: 100000,
  maxInputTokens: 80000,
  maxOutputTokens: 8000,
  maxWholeInputTokens: 70000,
  byteFallbackTokenizer: true,
  wholeOutputBudgetValidated: true,
  source: 'Mock-only verified limits fixture',
};
const source = (kind: ExtractionKind) => [
  {
    id: ITEM_FOR[kind] + ':p1',
    text: 'We invest in our operations and report material risks. '.repeat(300),
  },
  {
    id: ITEM_FOR[kind] + ':p2',
    text: 'This is the complete section of the filing. '.repeat(340),
  },
];
const body = (kind: ExtractionKind) => ({
  groups: TOPICS[kind].map((topic) => ({ topic, findings: [] })),
  ...(kind === 'mda' ? { capitalAllocation: emptyCapitalInformation() } : {}),
});
const answer = (kind: ExtractionKind) => ({
  output: body(kind),
  usage: { inputTokens: 100, outputTokens: 20 },
  finishReason: 'stop',
  response: { modelId: 'mock-model' },
});
const config = (extra: Record<string, string> = {}) =>
  new ConfigService({
    ROUTER_API_KEY: 'mock-only',
    ROUTER_BASE_URL: provider,
    AI_MODEL: 'mock-model',
    ...extra,
  });
beforeEach(() => jest.mocked(generateText).mockReset());
it.each(['business', 'mda', 'risks'] as const)(
  '%s rejects cross-Item input before any model request',
  async (kind) => {
    const wrong = kind === 'business' ? 'risks' : 'business';
    await expect(
      new SummaryModel(config()).generateLegacyChunks(
        kind,
        source(wrong),
        async () => {},
      ),
    ).rejects.toThrow('只允许');
    expect(generateText).not.toHaveBeenCalled();
  },
);
it.each(['business', 'mda', 'risks'] as const)(
  '%s defaults to same-Item chunks but permits one whole-Item request only with a confirmed matching profile',
  async (kind) => {
    jest.mocked(generateText).mockResolvedValue(answer(kind) as never);
    const chunked = await new SummaryModel(config()).generateLegacyChunks(
      kind,
      source(kind),
      async () => {},
    );
    expect(chunked.usage.inputPlan?.mode).toBe('item-chunks');
    expect(generateText).toHaveBeenCalledTimes(3);
    for (const [options] of jest.mocked(generateText).mock.calls.slice(0, 2)) {
      expect(options.prompt).toContain(ITEM_FOR[kind] + ':');
      for (const other of Object.values(ITEM_FOR).filter(
        (x) => x !== ITEM_FOR[kind],
      ))
        expect(options.prompt).not.toContain(other + ':');
    }
    jest.mocked(generateText).mockClear();
    const full = await new SummaryModel(
      config({ AI_ITEM_LIMITS_JSON: JSON.stringify(profile) }),
    ).generateLegacyChunks(kind, source(kind), async () => {});
    expect(full.usage.inputPlan?.mode).toBe('whole-item');
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(jest.mocked(generateText).mock.calls[0][0].prompt).toContain(':p2');
  },
);
it.each([
  { ...profile, model: 'other' },
  { ...profile, provider: 'https://another.example/v1' },
  { ...profile, maxWholeInputTokens: 1000 },
  { ...profile, wholeOutputBudgetValidated: false },
  { ...profile, byteFallbackTokenizer: false },
])('unconfirmed or insufficient limits fall back safely', (p) => {
  expect(
    planItem(
      config({ AI_ITEM_LIMITS_JSON: JSON.stringify(p) }),
      'mda',
      source('mda'),
      'prompt',
      'mock-model',
      provider,
    ).mode,
  ).toBe('item-chunks');
});
it('preserves all original text and paragraph order while preferring whitespace boundaries in long paragraphs', () => {
  const text = 'A long disclosed sentence with whitespace. '.repeat(1500);
  const parts = itemParagraphs([{ id: 'Item 7:p1', text }]);
  expect(parts.map((p) => p.text).join('')).toBe(text);
  expect(parts.every((p) => p.text.length <= 18000)).toBe(true);
  expect(parts.slice(0, -1).every((p) => /\s$/.test(p.text))).toBe(true);
  expect(parts.map((p) => p.id)).toEqual(
    parts.map((_, i) => `Item 7:p1:part${i + 1}`),
  );
});
it('risks require structured type, impact or explicit null, and exact Item1A evidence', () => {
  const p = {
    id: 'Item 1A:p1',
    text: 'Competition may reduce demand and adversely affect operating results.',
  };
  const finding = {
    riskType: '竞争风险',
    kind: '公司披露的事实',
    text: '竞争可能降低需求。',
    impact: '可能影响经营业绩。',
    evidence: [{ paragraphId: p.id, quote: p.text }],
  };
  const value = { groups: [{ topic: '重大风险', findings: [finding] }] };
  expect(validateItemSummary(value, 'risks', [p]).groups).toHaveLength(1);
  expect(() =>
    validateItemSummary(value, 'risks', [
      { ...p, text: 'Different disclosed text.' },
    ]),
  ).toThrow('引用');
  expect(() =>
    validateItemSummary(value, 'risks', [{ ...p, id: 'Item 7:p1' }]),
  ).toThrow('边界');
  expect(() =>
    validateItemSummary(
      {
        groups: [
          { topic: '重大风险', findings: [{ ...finding, impact: undefined }] },
        ],
      },
      'risks',
      [p],
    ),
  ).toThrow();
  expect(
    validateItemSummary(
      {
        groups: [
          { topic: '重大风险', findings: [{ ...finding, impact: null }] },
        ],
      },
      'risks',
      [p],
    ),
  ).toBeDefined();
});
it('source identity fences checkpoint reuse between Items, even when a storage fixture incorrectly shares its JSON', async () => {
  let progress: unknown = {};
  const checkpoint = {
    load: async () => progress,
    save: async (v: unknown) => {
      progress = structuredClone(v);
    },
  };
  for (const kind of ['mda', 'risks'] as const) {
    jest.mocked(generateText).mockResolvedValue(answer(kind) as never);
    await new SummaryModel(
      config({ AI_ITEM_LIMITS_JSON: JSON.stringify(profile) }),
    ).generateLegacyChunks(kind, source(kind), async () => {}, {
      source: {
        cik: '1',
        accessionNumber: 'a',
        parserVersion: 'v',
        inputHash: digest(source(kind)),
        item: ITEM_FOR[kind],
      },
      checkpoint,
      signal: new AbortController().signal,
    });
  }
  expect(generateText).toHaveBeenCalledTimes(2);
});
it('independent Item updates publish only their own cache; management orchestration continues to risks after Item7 failure', async () => {
  const service = new AiResearchService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const originalBusiness = { retained: true };
  const published = new Map<string, unknown>([
    ['Item 1', originalBusiness],
    ['Item 7', { retained: true }],
  ]);
  const generate = jest
    .spyOn(service, 'generateItem')
    .mockImplementation(async (_id, item) => {
      if (item === 'Item 7') throw new Error('Mock timeout');
      published.set(item, { success: true });
      return {} as never;
    });
  await expect(
    service.generate('TEST', 'management', true, { companyCik: '1' } as never),
  ).rejects.toThrow('Item 7');
  expect(generate.mock.calls.map((call) => call[1])).toEqual([
    'Item 7',
    'Item 1A',
  ]);
  expect(published.get('Item 1')).toBe(originalBusiness);
  expect(published.get('Item 7')).toEqual({ retained: true });
  expect(published.get('Item 1A')).toEqual({ success: true });
});
it('composition preserves independently dated sources and reuses Item7 capital information without publishing another summary', () => {
  const row = (section: string, fiscalYear: number, summaryJson: unknown) => ({
    section,
    fiscalYear,
    summaryJson,
    filingDate: `${fiscalYear + 1}-02-01`,
    accessionNumber: `acc-${section}`,
    sourceUrl: `https://www.sec.gov/${section}`,
    promptVersion: `${section}-v1`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mda = row('mda', 2025, body('mda'));
  const risk = row('risks', 2024, body('risks'));
  const result = composeManagement(mda as never, risk as never, null)!;
  const content = result.summaryJson as unknown as ReturnType<typeof body> & {
    itemSources: { legacy: boolean; accessionNumber: string }[];
    unavailableItems: string[];
  };
  expect(content.groups).toHaveLength(4);
  expect(content.capitalAllocation).toBe(
    (mda.summaryJson as ReturnType<typeof body>).capitalAllocation,
  );
  expect(content.itemSources.map((s) => s.accessionNumber)).toEqual([
    'acc-mda',
    'acc-risks',
  ]);
  expect(content.itemSources.every((s) => !s.legacy)).toBe(true);
  const legacy = row('management', 2023, {
    groups: TOPICS.management.map((topic) => ({ topic, findings: [] })),
  });
  const old = composeManagement(null, null, legacy as never)!;
  expect(old.promptVersion).toBe(legacy.promptVersion);
  expect(
    (old.summaryJson as unknown as typeof content).itemSources.every(
      (s) => s.legacy,
    ),
  ).toBe(true);
  const partial = composeManagement(mda as never, null, null)!;
  expect(
    (partial.summaryJson as unknown as typeof content).unavailableItems,
  ).toEqual(['Item 1A']);
});

it.each([
  { ...profile, contextWindow: 1000 },
  { ...profile, maxInputTokens: 1000 },
  { ...profile, maxOutputTokens: 1000 },
])(
  'known limits that cannot fit even one chunk block paid requests',
  async (p) => {
    await expect(
      new SummaryModel(
        config({ AI_ITEM_LIMITS_JSON: JSON.stringify(p) }),
      ).generateLegacyChunks('mda', source('mda'), async () => {}),
    ).rejects.toThrow('限制');
    expect(generateText).not.toHaveBeenCalled();
  },
);
it('end-to-end mock generation keeps three independent task checkpoints and summary rows; failure leaves other Items published', async () => {
  type Task = {
    id: string;
    token: string | null;
    status: string;
    leaseUntil: Date;
    progress: unknown;
    error: string | null;
  };
  const tasks = new Map<string, Task>();
  const rows = new Map<string, Record<string, unknown>>();
  const key = (x: {
    section: string;
    promptVersion: string;
    accessionNumber: string;
  }) => `${x.section}:${x.promptVersion}:${x.accessionNumber}`;
  const company = { cik: '0000000001', ticker: 'TEST', name: 'Test' };
  const db = {
    company: {
      upsert: jest.fn(),
      findUniqueOrThrow: jest.fn(async () => company),
    },
    aiTask: {
      upsert: jest.fn(async ({ where, create }) => {
        if (!tasks.has(where.id))
          tasks.set(where.id, {
            progress: {},
            token: null,
            error: null,
            ...create,
          });
      }),
      findUnique: jest.fn(async ({ where }) =>
        structuredClone(tasks.get(where.id) ?? null),
      ),
      updateMany: jest.fn(async ({ where, data }) => {
        const t = tasks.get(where.id);
        if (
          !t ||
          (where.token !== undefined && where.token !== t.token) ||
          (where.status && where.status !== t.status) ||
          (where.leaseUntil?.gt && t.leaseUntil <= where.leaseUntil.gt) ||
          (where.leaseUntil?.lte && t.leaseUntil > where.leaseUntil.lte)
        )
          return { count: 0 };
        Object.assign(t, structuredClone(data));
        return { count: 1 };
      }),
    },
    aiSummary: {
      findUnique: jest.fn(
        async ({ where }) =>
          rows.get(
            key(where.companyCik_accessionNumber_section_promptVersion),
          ) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }) =>
          [...rows.values()].find(
            (r) =>
              r.section === where.section &&
              (typeof where.promptVersion === 'string'
                ? r.promptVersion === where.promptVersion
                : where.promptVersion.in.includes(r.promptVersion)),
          ) ?? null,
      ),
      upsert: jest.fn(async ({ create }) => {
        const row = { ...create, createdAt: new Date(), updatedAt: new Date() };
        rows.set(key(create), row);
        return row;
      }),
    },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async (callback) => callback(db));
  const filing = {
    id: 'cached-parser-record',
    companyCik: company.cik,
    accessionNumber: 'cached-accession',
    parserVersion: 'items-v2',
    filingType: '10-K',
    fiscalYear: 2025,
    reportDate: '2025-12-31',
    filingDate: '2026-02-01',
    sourceUrl: 'https://www.sec.gov/Archives/cached.htm',
    sections: Object.fromEntries(
      Object.values(ITEM_FOR).map((item) => [
        item,
        [
          {
            id: item + ':p1',
            text: 'This is cached SEC filing evidence, used without downloading or changing financial data.',
          },
        ],
      ]),
    ),
  };
  let failRisk = true;
  jest.mocked(generateText).mockImplementation(async (options) => {
    const kind: ExtractionKind = String(options.system).includes(
      'capitalAllocation',
    )
      ? 'mda'
      : String(options.system).includes('风险披露结构化')
        ? 'risks'
        : 'business';
    if (kind === 'risks' && failRisk) throw new Error('Mock risk timeout');
    return answer(kind) as never;
  });
  const client = { getJson: jest.fn(), getText: jest.fn() };
  const service = new AiResearchService(
    db as never,
    {} as never,
    client as never,
    new SummaryModel(
      config({
        AI_ITEM_LIMITS_JSON: JSON.stringify({
          ...profile,
          maxOutputTokens: 32000,
        }),
      }),
    ),
  );
  await service.generateItem('TEST', 'Item 1', true, filing as never);
  await expect(
    service.generate('TEST', 'management', true, filing as never),
  ).rejects.toThrow('Item 1A');
  expect(rows.size).toBe(2);
  expect(tasks.get(company.cik + ':Item 1:whole-item')!.status).toBe('READY');
  expect(tasks.get(company.cik + ':Item 7:whole-item')!.status).toBe('READY');
  expect(tasks.get(company.cik + ':Item 1A:whole-item')!.status).toBe('FAILED');
  for (const row of rows.values()) {
    const content = row.summaryJson as {
      extraction: { item: string; filingId: string; inputHash: string };
    };
    expect(content.extraction.filingId).toBe(filing.id);
    expect(content.extraction.inputHash).toBe(
      digest(filing.sections[content.extraction.item]),
    );
  }
  const partial = await service.state(company.cik, 'management');
  expect(
    (partial.summary!.summaryJson as unknown as { unavailableItems: string[] })
      .unavailableItems,
  ).toEqual(['Item 1A']);
  failRisk = false;
  await service.generateItem('TEST', 'Item 1A', true, filing as never);
  expect(rows.size).toBe(3);
  jest.mocked(generateText).mockClear();
  await service.generateItem('TEST', 'Item 1', false, filing as never);
  await service.generate('TEST', 'management', false, filing as never);
  const state = await service.state(company.cik, 'management');
  expect(state.status).toBe('READY');
  expect(
    (state.summary!.summaryJson as unknown as { groups: unknown[] }).groups,
  ).toHaveLength(4);
  expect(generateText).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
  expect(client.getText).not.toHaveBeenCalled();
});
