import { generateText } from 'ai';
import { ConfigService } from '@nestjs/config';
import {
  SummaryModel,
  requestTimeoutMs,
} from '../src/modules/ai-research/summary-model';
import {
  GenerationCheckpoint,
  digest,
  type GenerationCheckpointData,
} from '../src/modules/ai-research/generation-checkpoint';
import { validateItemSummary } from '../src/modules/ai-research/summary-schema';
import { TOPICS } from '../src/modules/ai-research/summary-schema';
import { emptyCapitalInformation } from '../src/modules/ai-research/capital-information';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { json: () => ({}) },
  APICallError: { isInstance: () => false },
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => ({}) }),
}));
const paragraphs = [
  { id: 'Item 7:p1', text: 'Infrastructure investment. '.repeat(530) },
  { id: 'Item 7:p2', text: 'Competitive risks. '.repeat(780) },
];
const output = () => ({
  groups: TOPICS.mda.map((topic) => ({ topic, findings: [] })),
  capitalAllocation: emptyCapitalInformation(),
});
const response = (value: unknown = output()) => ({
  output: value,
  usage: { inputTokens: 11, outputTokens: 7 },
  response: {
    modelId: 'actual-mock',
    id: 'response-1',
    headers: { 'x-request-id': 'request-1' },
  },
  finishReason: 'stop',
});
function fixture() {
  let stored: unknown = {};
  const writes: GenerationCheckpointData[] = [];
  const checkpoint = {
    load: async () => structuredClone(stored),
    save: async (value: unknown) => {
      stored = structuredClone(value);
      writes.push(stored as GenerationCheckpointData);
    },
  };
  const execution = {
    source: {
      cik: '0000000001',
      accessionNumber: 'test',
      parserVersion: 'items-v2',
      inputHash: digest(paragraphs),
    },
    checkpoint,
    signal: new AbortController().signal,
  };
  const run = (extra: Record<string, string> = {}, ps = paragraphs) =>
    new SummaryModel(
      new ConfigService({ ROUTER_API_KEY: 'mock-only', ...extra }),
    ).generateLegacyChunks('mda', ps, async () => {}, execution);
  return {
    run,
    execution,
    writes,
    read: () => stored as GenerationCheckpointData,
  };
}
beforeEach(() => jest.mocked(generateText).mockReset());
it('persists chunk1 before chunk2; timeout preserves nullable usage; explicit resume and publication retry reuse validated work', async () => {
  const f = fixture();
  jest
    .mocked(generateText)
    .mockResolvedValueOnce(response() as never)
    .mockImplementationOnce(async () => {
      expect(f.read().steps['chunk-1'].status).toBe('succeeded');
      throw new DOMException('request timed out', 'TimeoutError');
    });
  await expect(f.run()).rejects.toThrow('Chunk 2');
  expect(generateText).toHaveBeenCalledTimes(2);
  expect(f.read().steps['chunk-1'].status).toBe('succeeded');
  expect(f.read().attempts[1]).toMatchObject({
    status: 'unknown',
    inputTokens: null,
    outputTokens: null,
  });
  expect(f.read().attempts[0]).toMatchObject({
    model: 'actual-mock',
    providerRequestId: 'request-1',
    providerResponseId: 'response-1',
  });
  jest
    .mocked(generateText)
    .mockReset()
    .mockResolvedValue(response() as never);
  const resumed = await f.run({ AI_REQUEST_TIMEOUT_MS: '200000' });
  expect(generateText).toHaveBeenCalledTimes(2);
  expect(resumed.usage.checkpoint).toMatchObject({
    newRequests: 2,
    reusedChunks: 1,
    historicalKnownInputTokens: 11,
    historicalKnownOutputTokens: 7,
    historicalUnknownUsageRequests: 1,
    knownInputTokens: 22,
  });
  // Publication may fail after this point: next explicit execution performs no model requests.
  jest.mocked(generateText).mockClear();
  const retry = await f.run();
  expect(generateText).not.toHaveBeenCalled();
  expect(retry.usage.checkpoint).toMatchObject({
    newRequests: 0,
    reusedChunks: 2,
    reusedMerge: true,
    knownInputTokens: 0,
  });
});
it('merge failure resumes only merge and preserves all capital fields', async () => {
  const f = fixture();
  jest
    .mocked(generateText)
    .mockResolvedValueOnce(response() as never)
    .mockResolvedValueOnce(response() as never)
    .mockRejectedValueOnce(new Error('merge failure'));
  await expect(f.run()).rejects.toThrow('最终合并');
  expect(f.read().steps['chunk-2'].status).toBe('succeeded');
  jest
    .mocked(generateText)
    .mockReset()
    .mockResolvedValue(response() as never);
  expect((await f.run()).summary.capitalAllocation).toBeDefined();
  expect(generateText).toHaveBeenCalledTimes(1);
});
it.each(['schema', 'evidence', 'truncated'])(
  'rejects %s failures before checkpoint success',
  async (kind) => {
    const f = fixture();
    const result = response();
    if (kind === 'schema') result.output = {} as never;
    if (kind === 'truncated') result.finishReason = 'length';
    if (kind === 'evidence')
      (result.output as ReturnType<typeof output>).groups[0].findings = [
        {
          kind: '公司披露的事实',
          text: '未核实',
          evidence: [
            {
              paragraphId: 'Item 7:p1',
              quote: 'This quote was never disclosed.',
            },
          ],
        },
      ] as never;
    jest.mocked(generateText).mockResolvedValue(result as never);
    await expect(f.run()).rejects.toThrow();
    expect(f.read().steps['chunk-1'].status).toBe('failed');
    expect(f.read().steps['chunk-1'].output).toBeUndefined();
    expect(f.read().attempts[0]).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      status: 'failed',
    });
  },
);
it('actual model or raw input changes invalidate successful maps; a modified checkpoint is revalidated', async () => {
  const f = fixture();
  jest.mocked(generateText).mockResolvedValue(response() as never);
  await f.run();
  jest.mocked(generateText).mockClear();
  await f.run({ AI_MODEL: 'different-model' });
  expect(generateText).toHaveBeenCalledTimes(3);
  jest.mocked(generateText).mockClear();
  await f.run(
    {},
    paragraphs.map((p) => ({ ...p, text: p.text + ' changed' })),
  );
  expect(generateText).toHaveBeenCalledTimes(3);
});
it.each([
  'cik',
  'accessionNumber',
  'parserVersion',
  'inputHash',
  'promptHash',
  'schemaHash',
  'model',
  'parameters',
])(
  'identity %s must match, including prompt/schema versions and output parameters',
  async (key) => {
    let stored: unknown = {};
    const io = {
      load: async () => stored,
      save: async (v: unknown) => {
        stored = structuredClone(v);
      },
    };
    const identity = {
      cik: 'cik',
      accessionNumber: 'a',
      parserVersion: 'p',
      inputHash: 'i',
      promptHash: 'p',
      schemaHash: 's',
      model: 'm',
      parameters: { maxOutputTokens: 8000 },
    };
    const plan = [{ index: 1, inputHash: 'in', paragraphIds: ['Item 7:p1'] }];
    const first = new GenerationCheckpoint(io);
    await first.prepare(identity, plan);
    await first.success('chunk-1', 'in', output());
    const second = new GenerationCheckpoint(io);
    await second.prepare({ ...identity, [key]: 'changed' }, plan);
    expect(
      await second.reuse(
        'chunk-1',
        'in',
        (v) => v as ReturnType<typeof output>,
      ),
    ).toBeUndefined();
  },
);
it('canonical JSONB object ordering survives round-trip; tampering, invalid evidence and changed order do not', async () => {
  const f = fixture();
  jest.mocked(generateText).mockResolvedValue(response() as never);
  await f.run();
  f.read().steps['chunk-1'].output = { broken: true };
  jest.mocked(generateText).mockClear();
  await f.run();
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  jest.mocked(generateText).mockClear();
  await f.run({}, [...paragraphs].reverse());
  expect(generateText).toHaveBeenCalledTimes(3);
});
it('recovers an interrupted in-flight attempt as unknown, without pretending tokens are zero', async () => {
  let stored: unknown = {};
  const io = {
    load: async () => stored,
    save: async (v: unknown) => {
      stored = structuredClone(v);
    },
  };
  const first = new GenerationCheckpoint(io);
  await first.prepare({ a: 1 }, []);
  await first.begin('merge', 'input', null);
  const next = new GenerationCheckpoint(io);
  await next.prepare({ a: 1 }, []);
  expect((stored as GenerationCheckpointData).attempts[0]).toMatchObject({
    status: 'unknown',
    inputTokens: null,
    outputTokens: null,
  });
  expect(next.usage()).toMatchObject({
    newRequests: 0,
    historicalUnknownUsageRequests: 1,
  });
});
it('uses bounded 600-second default timeout; does not disable cancellation', () => {
  expect(requestTimeoutMs(new ConfigService())).toBe(600000);
  for (const value of ['0', 'Infinity', '1800001', 'NaN'])
    expect(() =>
      requestTimeoutMs(new ConfigService({ AI_REQUEST_TIMEOUT_MS: value })),
    ).toThrow();
});
it('bounded timeout cancels an in-flight request, records unknown usage and never automatically retries', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest.mocked(generateText).mockImplementationOnce(async (options) => {
      entered();
      return (await new Promise((_, reject) => {
        options.abortSignal!.addEventListener(
          'abort',
          () => reject(options.abortSignal!.reason),
          { once: true },
        );
      })) as never;
    });
    // Native AbortSignal.timeout uses Node timers; replace only the timer source for this test.
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(
          () => controller.abort(new DOMException('timeout', 'TimeoutError')),
          ms,
        );
        return controller.signal;
      });
    try {
      const result = f.run({ AI_REQUEST_TIMEOUT_MS: '1000' });
      const rejected = expect(result).rejects.toThrow('AI请求超时');
      await started;
      await jest.advanceTimersByTimeAsync(1000);
      await rejected;
      expect(generateText).toHaveBeenCalledTimes(1);
      expect(f.read().attempts[0]).toMatchObject({
        status: 'unknown',
        inputTokens: null,
        outputTokens: null,
        elapsedMs: 1000,
      });
      expect(f.read().steps['chunk-2'].status).toBe('pending');
    } finally {
      timeout.mockRestore();
    }
  } finally {
    jest.useRealTimers();
  }
});
it('persists bounded field diagnostics for a refused financing record without saving the failed model output', async () => {
  const f = fixture();
  const value = output();
  value.capitalAllocation.debtAndFinancing.financingActivities = [
    {
      kind: 'fact',
      activityType: 'actualFinancing',
      text: '不可保存的原始模型整段内容',
      evidence: [
        {
          paragraphId: paragraphs[0].id,
          quote: paragraphs[0].text.slice(0, 27),
        },
      ],
    },
  ];
  jest.mocked(generateText).mockResolvedValue(response(value) as never);
  try {
    await f.run();
    throw Error('Expected validation failure');
  } catch (error) {
    const body = (
      error as { getResponse(): { message: string; diagnostics: unknown[] } }
    ).getResponse();
    expect(body.message).toContain(
      'Item 7 Chunk 1 capitalAllocation.debtAndFinancing.financingActivities[0]',
    );
    expect(body.diagnostics[0]).toMatchObject({
      item: 'Item 7',
      chunk: 1,
      fieldPath: 'capitalAllocation.debtAndFinancing.financingActivities[0]',
      errorType: 'FINANCING_ACTUAL_EVIDENCE_INSUFFICIENT',
      paragraphIds: ['Item 7:p1'],
    });
    expect(f.read().attempts[0].diagnostics).toEqual(body.diagnostics);
    expect(f.read().steps['chunk-1'].diagnostics).toEqual(body.diagnostics);
  }
  expect(f.read().steps['chunk-1'].output).toBeUndefined();
  expect(JSON.stringify(f.read())).not.toContain('不可保存的原始模型整段内容');
  expect(generateText).toHaveBeenCalledTimes(1);
});
// Exercise the registered historical transition explicitly. Future prompt/quality
// changes are deliberately NOT automatically validator-compatible.
async function historicalCheckpoint() {
  let stored: unknown = {};
  const io = {
    load: async () => structuredClone(stored),
    save: async (v: unknown) => {
      stored = structuredClone(v);
    },
  };
  const identity = {
    cik: '0000000001',
    accessionNumber: 'test',
    model: 'mock',
    promptHash: 'unchanged-historical-prompt',
    inputHash: digest(paragraphs),
    schemaHash:
      '47bc6fb7ec82e37b9dc7a2809c031b931fb81bd2cb029c88925bbbd68a79dc05',
  };
  const current = {
    ...identity,
    schemaHash:
      '928365eb81b9b758f4b833317bf8e24dceb57bb396946e716ae8fc7c6c5b8f5f',
  };
  const plan = [
    { index: 1, inputHash: 'in', paragraphIds: [paragraphs[0].id] },
  ];
  const initial = new GenerationCheckpoint(io);
  await initial.prepare(identity, plan);
  await initial.success('chunk-1', 'in', output());
  await initial.success('merge', 'merge-in', output());
  return { io, current, plan, read: () => stored as GenerationCheckpointData };
}
const revalidateHistorical = (v: unknown) =>
  validateItemSummary(v, 'mda', paragraphs, true);
it('an audited historical validator-only upgrade revalidates and reuses completed chunks and merge', async () => {
  const f = await historicalCheckpoint();
  const check = new GenerationCheckpoint(f.io);
  const validate = jest.fn(revalidateHistorical);
  await check.prepare(f.current, f.plan, validate);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(await check.reuse('chunk-1', 'in', revalidateHistorical)).toEqual(
    output(),
  );
  expect(await check.reuse('merge', 'merge-in', revalidateHistorical)).toEqual(
    output(),
  );
  expect(generateText).not.toHaveBeenCalled();
});
it('a validator compatibility entry cannot bypass changed model identity', async () => {
  const f = await historicalCheckpoint();
  const check = new GenerationCheckpoint(f.io);
  await check.prepare(
    { ...f.current, model: 'changed-model' },
    f.plan,
    revalidateHistorical,
  );
  expect(
    await check.reuse('chunk-1', 'in', revalidateHistorical),
  ).toBeUndefined();
});
it('validator upgrade still rejects cached fabricated evidence even when its output hash matches', async () => {
  const f = await historicalCheckpoint();
  const previous = f.read();
  const value = output();
  value.groups[0].findings = [
    {
      kind: '公司披露的事实',
      text: '无依据的内容',
      evidence: [
        {
          paragraphId: paragraphs[0].id,
          quote: 'This fabricated passage is not in the SEC input.',
        },
      ],
    },
  ] as never;
  previous.steps['chunk-1'].output = value;
  previous.steps['chunk-1'].outputHash = digest(value);
  await f.io.save(previous);
  const check = new GenerationCheckpoint(f.io);
  await check.prepare(f.current, f.plan, revalidateHistorical);
  expect(
    await check.reuse('chunk-1', 'in', revalidateHistorical),
  ).toBeUndefined();
  expect(await check.reuse('merge', 'merge-in', revalidateHistorical)).toEqual(
    output(),
  );
});
