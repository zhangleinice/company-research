import { ConfigService } from '@nestjs/config';
import { generateText } from 'ai';
import {
  SummaryModel,
  requestTimeoutMs,
} from '../src/modules/ai-research/summary-model';
import { TOPICS } from '../src/modules/ai-research/summary-schema';
import { emptyCapitalInformation } from '../src/modules/ai-research/capital-information';
import {
  maxOutputTokensFor,
  wholeItemTaskId,
} from '../src/modules/ai-research/whole-item-input';
import {
  modelTransport,
  modelTransportTimeouts,
} from '../src/modules/ai-research/model-transport';
import {
  digest,
  type GenerationCheckpointData,
} from '../src/modules/ai-research/generation-checkpoint';
import type { ExtractionKind } from '../src/modules/ai-research/item-extraction';
jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { json: () => ({}) },
  APICallError: { isInstance: () => false },
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => ({}) }),
}));
const provider = 'https://mock-router.example/v1';
const limits = {
  model: 'mock-model',
  provider,
  contextWindow: 1000000,
  maxInputTokens: 800000,
  maxOutputTokens: 128000,
  byteFallbackTokenizer: true,
  source:
    'Mock-only confirmed service limits, not actual Router specifications',
};
const config = (extra: Record<string, string> = {}) =>
  new ConfigService({
    ROUTER_API_KEY: 'mock-only',
    ROUTER_BASE_URL: provider,
    AI_MODEL: 'mock-model',
    AI_ITEM_LIMITS_JSON: JSON.stringify(limits),
    ...extra,
  });
const itemFor = { business: 'Item 1', risks: 'Item 1A', mda: 'Item 7' };
const paragraphs = (kind: ExtractionKind) => [
  {
    id: itemFor[kind] + ':p1',
    text: 'A complete paragraph retained without splitting. '.repeat(4500),
  },
  {
    id: itemFor[kind] + ':p2',
    text: 'The last paragraph contains evidence for the complete Item.',
  },
];
const body = (kind: ExtractionKind) => ({
  groups: TOPICS[kind].map((topic) => ({ topic, findings: [] })),
  ...(kind === 'mda' ? { capitalAllocation: emptyCapitalInformation() } : {}),
});
const response = (kind: ExtractionKind) => ({
  output: body(kind),
  finishReason: 'stop',
  usage: { inputTokens: 100, outputTokens: 20 },
  response: { modelId: 'actual-mock' },
});
function io() {
  let saved: unknown = {};
  return {
    load: async () => structuredClone(saved),
    save: async (v: unknown) => {
      saved = structuredClone(v);
    },
    read: () => saved as GenerationCheckpointData,
  };
}
const execution = (
  kind: ExtractionKind,
  checkpoint: ReturnType<typeof io>,
) => ({
  source: {
    cik: '0000000001',
    accessionNumber: 'test-accession',
    parserVersion: 'items-v2',
    item: itemFor[kind] as 'Item 1' | 'Item 1A' | 'Item 7',
    inputHash: digest(paragraphs(kind)),
  },
  checkpoint,
  signal: new AbortController().signal,
});
beforeEach(() => jest.mocked(generateText).mockReset());
it.each(['business', 'mda', 'risks'] as const)(
  '%s sends the full Item in exactly one request, with original long paragraphs and no extra merge',
  async (kind) => {
    const ps = paragraphs(kind);
    jest.mocked(generateText).mockResolvedValue(response(kind) as never);
    const checkpoint = io();
    const result = await new SummaryModel(config()).generate(
      kind,
      ps,
      async () => {},
      execution(kind, checkpoint),
    );
    expect(generateText).toHaveBeenCalledTimes(1);
    const options = jest.mocked(generateText).mock.calls[0][0];
    expect(options.prompt).toContain(JSON.stringify(ps));
    expect(options.prompt).not.toContain(':part');
    expect(options.maxOutputTokens).toBe(32000);
    expect(options.maxRetries).toBe(0);
    for (const item of Object.values(itemFor).filter(
      (item) => item !== itemFor[kind],
    ))
      expect(options.prompt).not.toContain(item + ':p');
    expect(checkpoint.read().steps['whole-item'].status).toBe('succeeded');
    expect(checkpoint.read().steps).not.toHaveProperty('merge');
    expect(checkpoint.read().steps).not.toHaveProperty('chunk-1');
    expect(checkpoint.read().attempts[0]).toMatchObject({
      phase: 'whole-item',
      chunk: null,
      status: 'succeeded',
    });
    expect(result.usage.inputPlan).toMatchObject({
      mode: 'whole-item',
      maxOutputTokens: 32000,
      timeoutMs: 600000,
    });
  },
);
it.each(['business', 'mda', 'risks'] as const)(
  '%s rejects another Item before any paid call',
  async (kind) => {
    await expect(
      new SummaryModel(config()).generate(
        kind,
        paragraphs(kind === 'mda' ? 'risks' : 'mda'),
        async () => {},
      ),
    ).rejects.toThrow('只允许');
    expect(generateText).not.toHaveBeenCalled();
  },
);
it.each([
  '',
  '{}',
  JSON.stringify({ ...limits, model: 'different' }),
  JSON.stringify({ ...limits, contextWindow: 32000 }),
  JSON.stringify({ ...limits, maxInputTokens: 1000 }),
  JSON.stringify({ ...limits, maxOutputTokens: 8000 }),
])(
  'unknown, mismatched or insufficient service limits block requests without truncation',
  async (profile) => {
    await expect(
      new SummaryModel(config({ AI_ITEM_LIMITS_JSON: profile })).generate(
        'mda',
        paragraphs('mda'),
        async () => {},
      ),
    ).rejects.toThrow();
    expect(generateText).not.toHaveBeenCalled();
  },
);
it('configures global and per-Item output budgets independently with a bounded long timeout', async () => {
  expect(maxOutputTokensFor(config(), 'mda')).toBe(32000);
  expect(requestTimeoutMs(config())).toBe(600000);
  const c = config({
    AI_MAX_OUTPUT_TOKENS: '24000',
    AI_MAX_OUTPUT_TOKENS_ITEM_7: '12000',
    AI_REQUEST_TIMEOUT_MS: '900000',
  });
  expect(maxOutputTokensFor(c, 'mda')).toBe(12000);
  expect(maxOutputTokensFor(c, 'risks')).toBe(24000);
  jest.mocked(generateText).mockResolvedValue(response('mda') as never);
  const result = await new SummaryModel(c).generate(
    'mda',
    paragraphs('mda'),
    async () => {},
  );
  expect(jest.mocked(generateText).mock.calls[0][0].maxOutputTokens).toBe(
    12000,
  );
  expect(result.usage.inputPlan?.timeoutMs).toBe(900000);
  for (const value of ['0', 'NaN', '128001'])
    expect(() =>
      maxOutputTokensFor(config({ AI_MAX_OUTPUT_TOKENS: value }), 'mda'),
    ).toThrow();
});
it.each(['length', 'invalid-schema', 'fabricated-evidence'])(
  'refuses %s output and never publishes an incomplete whole result',
  async (failure) => {
    const answer = response('mda');
    if (failure === 'length') answer.finishReason = 'length';
    if (failure === 'invalid-schema') answer.output = {} as never;
    if (failure === 'fabricated-evidence')
      answer.output.capitalAllocation!.reinvestment.investmentAreas = [
        {
          text: '不可靠内容',
          kind: 'fact',
          evidence: [
            {
              paragraphId: 'Item 7:p1',
              quote: 'This quote is not present in the actual Item.',
            },
          ],
        },
      ];
    const checkpoint = io();
    jest.mocked(generateText).mockResolvedValue(answer as never);
    await expect(
      new SummaryModel(config()).generate(
        'mda',
        paragraphs('mda'),
        async () => {},
        execution('mda', checkpoint),
      ),
    ).rejects.toThrow();
    expect(checkpoint.read().steps['whole-item'].status).toBe('failed');
    expect(checkpoint.read().steps['whole-item'].output).toBeUndefined();
    if (failure === 'length')
      expect(checkpoint.read().attempts[0].diagnostics?.[0].errorType).toBe(
        'OUTPUT_TRUNCATED',
      );
    expect(checkpoint.read().attempts[0]).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      status: 'failed',
    });
    expect(generateText).toHaveBeenCalledTimes(1);
  },
);
it('records returned SDK JSON-failure tokens; transport failures keep unknown usage null and are not retried', async () => {
  const checkpoint = io();
  const error = Object.assign(new Error('Incomplete JSON'), {
    usage: { inputTokens: 15, outputTokens: 9 },
    response: { modelId: 'actual-mock', id: 'response-1' },
  });
  jest.mocked(generateText).mockRejectedValueOnce(error);
  try {
    await new SummaryModel(config()).generate(
      'mda',
      paragraphs('mda'),
      async () => {},
      execution('mda', checkpoint),
    );
    throw Error('Expected rejection');
  } catch (e) {
    expect(
      (
        e as {
          getResponse(): {
            usage: { inputTokens: number; outputTokens: number };
          };
        }
      ).getResponse().usage,
    ).toMatchObject({ inputTokens: 15, outputTokens: 9 });
  }
  expect(checkpoint.read().attempts[0]).toMatchObject({
    status: 'failed',
    inputTokens: 15,
    outputTokens: 9,
  });
  const unknown = io();
  jest
    .mocked(generateText)
    .mockClear()
    .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
  await expect(
    new SummaryModel(config()).generate(
      'mda',
      paragraphs('mda'),
      async () => {},
      execution('mda', unknown),
    ),
  ).rejects.toThrow();
  expect(unknown.read().attempts[0]).toMatchObject({
    status: 'unknown',
    inputTokens: null,
    outputTokens: null,
  });
  expect(generateText).toHaveBeenCalledTimes(1);
});
it('never treats legacy chunk/merge outputs as a whole-Item checkpoint', async () => {
  const checkpoint = io(),
    ps = [
      {
        id: 'Item 7:p1',
        text: 'Complete cached disclosure about infrastructure spending.',
      },
    ];
  const exec = execution('mda', checkpoint);
  jest.mocked(generateText).mockResolvedValue(response('mda') as never);
  await new SummaryModel(config()).generateLegacyChunks(
    'mda',
    ps,
    async () => {},
    exec,
  );
  const old = structuredClone(checkpoint.read());
  jest.mocked(generateText).mockClear();
  await new SummaryModel(config()).generate('mda', ps, async () => {}, exec);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(checkpoint.read().identity.strategy).toBe('whole-item-v1');
  expect(checkpoint.read().steps).toHaveProperty('whole-item');
  expect(checkpoint.read().steps).not.toHaveProperty('merge');
  expect(old.steps).toHaveProperty('chunk-1');
  expect(wholeItemTaskId('cik', 'Item 7')).toBe('cik:Item 7:whole-item');
  jest.mocked(generateText).mockClear();
  const retried = await new SummaryModel(config()).generate(
    'mda',
    ps,
    async () => {},
    exec,
  );
  expect(generateText).not.toHaveBeenCalled();
  expect(retried.usage.checkpoint).toMatchObject({
    newRequests: 0,
    reusedWholeItem: true,
    reusedChunks: 0,
  });
});
it('raises transport header/body deadlines beyond the total request deadline and keeps AbortSignal cancellation', async () => {
  expect(modelTransportTimeouts(600000)).toEqual({
    headersTimeout: 601000,
    bodyTimeout: 601000,
  });
  const native = global.fetch;
  const fetch = jest.fn(async () => new Response('{}'));
  global.fetch = fetch as never;
  const transport = modelTransport(600000);
  const controller = new AbortController();
  try {
    await transport.fetch('https://mock-router.example/v1', {
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([
      'https://mock-router.example/v1',
      expect.objectContaining({
        signal: controller.signal,
        dispatcher: expect.anything(),
      }),
    ]);
  } finally {
    global.fetch = native;
    await transport.dispose();
  }
});
