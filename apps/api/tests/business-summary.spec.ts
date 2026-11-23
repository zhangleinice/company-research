import {
  TOPICS,
  validateSummary,
} from '../src/modules/ai-research/summary-schema';
import {
  BUSINESS_PROMPT_VERSION,
  MANAGEMENT_PROMPT_VERSION,
  PROMPT_VERSION,
  promptVersionFor,
} from '../src/modules/ai-research/summary-model';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';
const source = {
  id: 'Item 1:p1',
  text: 'Customers subscribe to our enterprise services for a recurring fee.',
};
function summary() {
  return {
    groups: TOPICS.business.map((topic) => ({
      topic: topic as string,
      findings: [] as Array<{
        kind: '公司披露的事实';
        text: string;
        businessName: string;
        offering: string;
        monetization: string;
        evidence: { paragraphId: string; quote: string }[];
      }>,
    })),
  };
}
it('accepts dynamic business counts with grounded commercial-model fields', () => {
  const result = summary();
  result.groups[1].findings = Array.from({ length: 7 }, (_, i) => ({
    kind: '公司披露的事实',
    text: '企业服务业务。',
    businessName: `Official Services ${i}`,
    offering: '向企业提供软件服务。',
    monetization: '企业按订阅付费。',
    evidence: [{ paragraphId: source.id, quote: source.text }],
  }));
  expect(
    validateSummary(result, 'business', [source]).groups[1].findings,
  ).toHaveLength(7);
  const invalid = structuredClone(result);
  invalid.groups[1].findings[0].monetization = '';
  expect(() => validateSummary(invalid, 'business', [source])).toThrow();
  result.groups.push({ topic: '业务依赖与风险', findings: [] });
  expect(() => validateSummary(result, 'business', [source])).toThrow();
});
it('rejects invented and out-of-scope evidence, with independent business and management versions', () => {
  const result = summary();
  result.groups[1].findings = [
    {
      kind: '公司披露的事实',
      text: '企业软件。',
      businessName: 'Enterprise',
      offering: '企业软件。',
      monetization: '订阅收费。',
      evidence: [{ paragraphId: 'Item 7:p1', quote: source.text }],
    },
  ];
  expect(() =>
    validateSummary(result, 'business', [{ ...source, id: 'Item 7:p1' }]),
  ).toThrow();
  result.groups[1].findings[0].evidence = [
    { paragraphId: source.id, quote: 'This quote does not exist' },
  ];
  expect(() => validateSummary(result, 'business', [source])).toThrow();
  expect(
    validateSummary(
      { groups: TOPICS.management.map((topic) => ({ topic, findings: [] })) },
      'management',
      [],
    ).groups,
  ).toHaveLength(4);
  expect(promptVersionFor('management')).toBe(MANAGEMENT_PROMPT_VERSION);
  expect(promptVersionFor('business')).toBe(BUSINESS_PROMPT_VERSION);
});
it('passive cache reads retain legacy business without generating or writing anything', async () => {
  const legacy = {
    promptVersion: PROMPT_VERSION,
    createdAt: new Date(),
    updatedAt: new Date(),
    summaryJson: { groups: [] },
  };
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(legacy);
  const generate = jest.fn();
  const db = {
    aiSummary: { findFirst },
    aiTask: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const service = new AiResearchService(
    db as never,
    {} as never,
    {} as never,
    { generate } as never,
  );
  expect(
    (await service.state('0001652044', 'business')).summary?.promptVersion,
  ).toBe(PROMPT_VERSION);
  expect(findFirst.mock.calls[0][0].where.promptVersion).toBe(
    BUSINESS_PROMPT_VERSION,
  );
  expect(generate).not.toHaveBeenCalled();
});
it('non-forced initial generation reuses the old accession cache without calling a model', async () => {
  const cached = {
    promptVersion: PROMPT_VERSION,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
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
      findUnique: jest.fn(async ({ where }) =>
        where.companyCik_accessionNumber_section_promptVersion.promptVersion ===
        PROMPT_VERSION
          ? cached
          : null,
      ),
    },
  };
  const generate = jest.fn();
  const service = new AiResearchService(
    db as never,
    {} as never,
    {} as never,
    { generate } as never,
  );
  const filing = {
    companyCik: '0001652044',
    accessionNumber: 'existing',
    fiscalYear: 2025,
    filingDate: '2026-02-05',
    reportDate: '2025-12-31',
    sourceUrl: 'https://www.sec.gov/Archives/existing',
  };
  expect(
    (await service.generate('GOOGL', 'business', false, filing as never))
      .cached,
  ).toBe(true);
  expect(generate).not.toHaveBeenCalled();
});
it('explicit refresh stores a new business version without overwriting the legacy cache key', async () => {
  const upsert = jest.fn().mockImplementation(async ({ create }) => ({
    ...create,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const transaction = jest.fn(async (callback) =>
    callback({
      aiTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      aiSummary: { upsert },
    }),
  );
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
    aiSummary: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: transaction,
  };
  const model = {
    generate: jest.fn().mockResolvedValue({
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
    sections: { 'Item 1': [source] },
  };
  const result = await service.generate(
    'GOOGL',
    'business',
    true,
    filing as never,
  );
  expect(result.summary?.promptVersion).toBe(BUSINESS_PROMPT_VERSION);
  expect(model.generate).toHaveBeenCalledWith(
    'business',
    [source],
    expect.any(Function),
    expect.objectContaining({
      source: expect.objectContaining({ item: 'Item 1' }),
    }),
  );
  expect(
    upsert.mock.calls[0][0].where
      .companyCik_accessionNumber_section_promptVersion.promptVersion,
  ).toBe(BUSINESS_PROMPT_VERSION);
});

it('new Business requires three questions and named businesses, excludes inferred or quantitative financial content', () => {
  const result = summary();
  result.groups[0].findings = [
    {
      kind: '公司披露的事实',
      businessName: 'Enterprise Services',
      text: '面向企业提供订阅软件。',
      offering: '企业软件。',
      monetization: '企业订阅付费。',
      evidence: [{ paragraphId: source.id, quote: source.text }],
    },
  ];
  expect(validateSummary(result, 'business', [source]).groups).toHaveLength(3);
  const old = structuredClone(result);
  old.groups.splice(2, 0, { topic: '公司有什么竞争优势？', findings: [] });
  expect(() => validateSummary(old, 'business', [source])).toThrow();
  for (const text of [
    '收入为100亿美元。',
    '利润率达到25%。',
    '收入为USD 100 million。',
  ]) {
    const invalid = structuredClone(result);
    invalid.groups[0].findings[0].text = text;
    expect(() => validateSummary(invalid, 'business', [source])).toThrow(
      '金额或百分比',
    );
  }
  const unnamed = structuredClone(result);
  unnamed.groups[0].findings[0].businessName = '';
  expect(() => validateSummary(unnamed, 'business', [source])).toThrow();
  const insufficient = structuredClone(result);
  insufficient.groups[1].findings = [
    {
      ...result.groups[0].findings[0],
      monetization: 'SEC披露信息不足，无法确认具体收费方式。',
    },
  ];
  expect(
    validateSummary(insufficient, 'business', [source]).groups[1].findings[0]
      .monetization,
  ).toContain('信息不足');
});
it('passive reads select existing four-question v3 caches instead of regenerating after version upgrade', async () => {
  const cached = {
    promptVersion: 'business-model-v3',
    summaryJson: { groups: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(cached);
  const model = { generate: jest.fn() };
  const service = new AiResearchService(
    {
      aiSummary: { findFirst },
      aiTask: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never,
    {} as never,
    {} as never,
    model as never,
  );
  expect(
    (await service.state('0001652044', 'business')).summary?.promptVersion,
  ).toBe('business-model-v3');
  expect(findFirst.mock.calls[1][0].where.promptVersion.in).toContain(
    'business-model-v3',
  );
  expect(model.generate).not.toHaveBeenCalled();
});
it('initialization with an old business cache and no previous task does not enqueue a paid update', async () => {
  const { CompanyUpdateService } =
    await import('../src/modules/ai-research/company-update.service');
  const createMany = jest.fn();
  const generate = jest.fn();
  const db = {
    company: { findUnique: jest.fn().mockResolvedValue({ cik: '0001652044' }) },
    aiSummary: {
      findMany: jest.fn(async ({ where }) =>
        where.OR.some(
          (entry: { section: string; promptVersion: { in?: string[] } }) =>
            entry.section === 'business' &&
            entry.promptVersion.in?.includes('business-model-v3'),
        )
          ? [{ section: 'business' }, { section: 'management' }]
          : [],
      ),
    },
    aiTask: { findUnique: jest.fn().mockResolvedValue(null), createMany },
  };
  const service = new CompanyUpdateService(
    db as never,
    {} as never,
    { generate } as never,
  );
  expect((await service.start('0001652044', 'INITIAL')).status).toBe('IDLE');
  expect(createMany).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});
