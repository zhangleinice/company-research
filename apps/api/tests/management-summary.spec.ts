import {
  TOPICS,
  validateSummary,
} from '../src/modules/ai-research/summary-schema';
import {
  MANAGEMENT_PROMPT_VERSION,
  promptVersionFor,
  PROMPT_VERSION,
} from '../src/modules/ai-research/summary-model';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';

const operating = {
  id: 'Item 7:p1',
  text: 'Higher demand increased sales while infrastructure spending increased costs.',
};
const risk = {
  id: 'Item 1A:p1',
  text: 'Competition may reduce demand for our products and services.',
};
function summary() {
  return {
    groups: TOPICS.management.map((topic, i) => ({
      topic: topic as string,
      findings: [
        {
          kind: '公司披露的事实' as const,
          text:
            i === 3
              ? '竞争可能降低需求。'
              : '需求增加推动销售，基础设施投入增加成本。',
          evidence: [
            {
              paragraphId: (i === 3 ? risk : operating).id,
              quote: (i === 3 ? risk : operating).text,
            },
          ],
        },
      ],
    })),
  };
}
it('accepts four grounded sections, including short or empty disclosures', () => {
  const result = summary();
  result.groups[2].findings = [];
  expect(
    validateSummary(result, 'management', [operating, risk]).groups,
  ).toHaveLength(4);
  result.groups.push({ topic: '资本开支', findings: [] });
  expect(() =>
    validateSummary(result, 'management', [operating, risk]),
  ).toThrow();
});
it('rejects fabricated quotes, wrong-section causes and risks without Item 1A support', () => {
  const fabricated = summary();
  fabricated.groups[0].findings[0].evidence[0].quote =
    'Unreported acquisition caused all EPS growth.';
  expect(() =>
    validateSummary(fabricated, 'management', [operating, risk]),
  ).toThrow();
  const wrongSource = summary();
  wrongSource.groups[0].findings[0].evidence = [
    { paragraphId: risk.id, quote: risk.text },
  ];
  expect(() =>
    validateSummary(wrongSource, 'management', [operating, risk]),
  ).toThrow();
  const unsupportedRisk = summary();
  unsupportedRisk.groups[3].findings[0].evidence = [
    { paragraphId: operating.id, quote: operating.text },
  ];
  expect(() =>
    validateSummary(unsupportedRisk, 'management', [operating, risk]),
  ).toThrow();
});
it('passive reads fall back to old management without model, SEC or writes', async () => {
  const legacy = {
    promptVersion: PROMPT_VERSION,
    summaryJson: { groups: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const findFirst = jest.fn(async ({ where }) =>
    where.section === 'management' && typeof where.promptVersion === 'object'
      ? legacy
      : null,
  );
  const model = { generate: jest.fn() };
  const client = { getJson: jest.fn(), getText: jest.fn() };
  const service = new AiResearchService(
    {
      aiSummary: { findFirst },
      aiTask: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never,
    {} as never,
    client as never,
    model as never,
  );
  expect(
    (await service.state('0001652044', 'management')).summary?.promptVersion,
  ).toBe(PROMPT_VERSION);
  expect(
    findFirst.mock.calls.some(
      ([args]) =>
        args.where.section === 'management' &&
        args.where.promptVersion === MANAGEMENT_PROMPT_VERSION,
    ),
  ).toBe(true);
  expect(model.generate).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
  expect(client.getText).not.toHaveBeenCalled();
});
it.each([false, true])(
  'explicit management force=%s preserves legacy or publishes independently',
  async (force) => {
    const legacy = {
      section: 'management',
      promptVersion: PROMPT_VERSION,
      summaryJson: summary(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const rows = new Map<string, unknown>();
    const upsert = jest.fn(async ({ create }) => {
      const row = { ...create, createdAt: new Date(), updatedAt: new Date() };
      rows.set(create.section, row);
      return row;
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = {
      company: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ cik: '0001652044', ticker: 'GOOGL' }),
        upsert: jest.fn(),
      },
      aiTask: {
        upsert: jest.fn(),
        updateMany,
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aiSummary: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(
          async ({ where }) =>
            rows.get(where.section) ??
            (where.section === 'management' ? legacy : null),
        ),
      },
      $transaction: jest.fn(async (cb) =>
        cb({ aiTask: { updateMany }, aiSummary: { upsert } }),
      ),
    };
    const { emptyCapitalInformation } =
      await import('../src/modules/ai-research/capital-information');
    const model = {
      generate: jest.fn(async (kind: string) => ({
        summary:
          kind === 'mda'
            ? {
                groups: summary().groups.slice(0, 3),
                capitalAllocation: emptyCapitalInformation(),
              }
            : { groups: [{ topic: '重大风险', findings: [] }] },
        usage: { calls: 0 },
        modelId: 'mock',
      })),
    };
    const service = new AiResearchService(
      db as never,
      {} as never,
      {} as never,
      model as never,
    );
    const filing = {
      companyCik: '0001652044',
      accessionNumber: 'existing',
      fiscalYear: 2025,
      filingDate: '2026-02-05',
      reportDate: '2025-12-31',
      sourceUrl: 'https://www.sec.gov/Archives/existing',
      sections: { 'Item 7': [operating], 'Item 1A': [risk] },
    };
    const result = await service.generate(
      'GOOGL',
      'management',
      force,
      filing as never,
    );
    expect(result.summary?.promptVersion).toBe(
      force ? 'item-composition-v1' : PROMPT_VERSION,
    );
    if (force) {
      expect(model.generate).toHaveBeenCalledTimes(2);
      expect(model.generate.mock.calls.map((call) => call[0])).toEqual([
        'mda',
        'risks',
      ]);
      expect(rows.size).toBe(2);
    } else {
      expect(model.generate).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    }
  },
);

it('binds unified extraction to its actual filing and independent paragraph snapshots; failed refresh keeps old summary', async () => {
  const { emptyCapitalInformation } =
    await import('../src/modules/ai-research/capital-information');
  const capital = emptyCapitalInformation();
  const p = {
    id: 'Item 7:p1',
    text: 'We expect to increase investment in technical infrastructure during 2026.',
  };
  capital.reinvestment.investmentPlans = [
    {
      text: '预计增加技术基础设施投资',
      kind: 'plan',
      evidence: [{ paragraphId: p.id, quote: p.text }],
    },
  ];
  const existing = {
    summaryJson: { groups: [] },
    promptVersion: MANAGEMENT_PROMPT_VERSION,
  };
  const upsert = jest.fn(async ({ create }) => ({
    ...create,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const db = {
    company: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ cik: '0001652044', ticker: 'GOOGL' }),
      upsert: jest.fn(),
    },
    aiTask: { upsert: jest.fn(), updateMany },
    aiSummary: { findUnique: jest.fn().mockResolvedValue(existing) },
    $transaction: jest.fn(async (cb) =>
      cb({ aiTask: { updateMany }, aiSummary: { upsert } }),
    ),
  };
  const model = {
    generate: jest.fn().mockResolvedValue({
      summary: {
        groups: summary().groups.slice(0, 3),
        capitalAllocation: capital,
      },
      usage: { calls: 0 },
      modelId: 'mock',
    }),
  };
  const filing = {
    id: 'original-record',
    companyCik: '0001652044',
    accessionNumber: '0001652044-26-000018',
    fiscalYear: 2025,
    filingType: '10-K',
    filingDate: '2026-02-05',
    reportDate: '2025-12-31',
    sourceUrl: 'https://www.sec.gov/Archives/example.htm',
    parserVersion: 'items-v2',
    sections: { 'Item 7': [p], 'Item 1A': [risk] },
  };
  const service = new AiResearchService(
    db as never,
    {} as never,
    {} as never,
    model as never,
  );
  const result = await service.generateItem(
    'GOOGL',
    'Item 7',
    true,
    filing as never,
  );
  const stored = result.summary!.summaryJson as unknown as {
    capitalAllocation: typeof capital;
  };
  expect(result.summary?.promptVersion).toBe(promptVersionFor('mda'));
  expect(stored.capitalAllocation.source).toMatchObject({
    filingId: 'original-record',
    parserVersion: 'items-v2',
    accessionNumber: filing.accessionNumber,
    item: 'Item 7',
  });
  expect(stored.capitalAllocation.source!.inputHash).toMatch(/^[a-f0-9]{64}$/);
  p.text = 'Changed by a later parse';
  expect(stored.capitalAllocation.source!.evidenceParagraphs[0].text).toContain(
    'expect to increase',
  );
  const before = JSON.stringify(existing);
  model.generate.mockRejectedValueOnce(new Error('Mock extraction failure'));
  await expect(
    service.generateItem('GOOGL', 'Item 7', true, filing as never),
  ).rejects.toThrow('Mock extraction failure');
  expect(upsert).toHaveBeenCalledTimes(1);
  model.generate.mockResolvedValueOnce({
    summary: { groups: summary().groups },
    usage: { calls: 0 },
    modelId: 'mock',
  } as never);
  await expect(
    service.generateItem('GOOGL', 'Item 7', true, filing as never),
  ).rejects.toThrow('缺少资本配置字段');
  expect(upsert).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(existing)).toBe(before);
  expect(updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }),
  );
});
