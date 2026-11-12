import {
  TOPICS,
  validateSummary,
} from '../src/modules/ai-research/summary-schema';
import {
  MANAGEMENT_PROMPT_VERSION,
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
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(legacy);
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
  expect(findFirst.mock.calls[0][0].where.promptVersion).toBe(
    MANAGEMENT_PROMPT_VERSION,
  );
  expect(model.generate).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
  expect(client.getText).not.toHaveBeenCalled();
});
it.each([false, true])(
  'management explicit force=%s preserves legacy or writes the new version using mocked generation',
  async (force) => {
    const legacy = {
      promptVersion: PROMPT_VERSION,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const upsert = jest.fn(async ({ create }) => ({
      ...create,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const db = {
      company: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ cik: '0001652044', ticker: 'GOOGL' }),
        upsert: jest.fn(),
      },
      aiTask: {
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aiSummary: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(legacy),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          aiTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          aiSummary: { upsert },
        }),
      ),
    };
    const model = {
      generate: jest
        .fn()
        .mockResolvedValue({
          summary: summary(),
          usage: { calls: 0 },
          modelId: 'mock',
        }),
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
      force ? MANAGEMENT_PROMPT_VERSION : PROMPT_VERSION,
    );
    if (force) {
      expect(model.generate).toHaveBeenCalledWith(
        'management',
        [operating, risk],
        expect.any(Function),
      );
      expect(
        upsert.mock.calls[0][0].where
          .companyCik_accessionNumber_section_promptVersion.promptVersion,
      ).toBe(MANAGEMENT_PROMPT_VERSION);
    } else {
      expect(model.generate).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    }
  },
);
