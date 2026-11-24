import { generateText } from 'ai';
import { ConfigService } from '@nestjs/config';
import type {
  AiResearchSummary,
  CapitalNote,
  AcquisitionEvent,
} from '@company-research/shared';
import {
  emptyCapitalInformation,
  validateCapitalInformation,
} from '../src/modules/ai-research/capital-information';
import {
  reviewItem7Quality,
  validateNewItem7Quality,
} from '../src/modules/ai-research/item7-quality';
import {
  TOPICS,
  validateItemSummary,
} from '../src/modules/ai-research/summary-schema';
import {
  SummaryModel,
  promptVersionFor,
} from '../src/modules/ai-research/summary-model';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';
import { CompanyUpdateService } from '../src/modules/ai-research/company-update.service';
jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { json: () => ({}) },
  APICallError: { isInstance: () => false },
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => ({}) }),
}));
// Verbatim evidence from the saved GOOGL FY2025 Item7 result and items-v2 cache, no SEC requests.
const source = {
  liquidity: {
    id: 'Item 7:p330',
    text: 'We expect existing cash, cash equivalents, short-term marketable securities, and cash flows from operations and financing activities to continue to be sufficient to fund our operating activities and cash commitments for investing and financing activities for at least the next 12 months, and thereafter for the foreseeable future.',
  },
  repurchases: {
    id: 'Item 7:p357',
    text: 'During 2025, we repurchased and subsequently retired 240 million shares for $45.4 billion.',
  },
  dividends: {
    id: 'Item 7:p361',
    text: 'During the year ended December 31, 2025, total cash dividends were $4.8 billion for Class A, $703 million for Class B, and $4.5 billion for Class C shares, respectively.',
  },
  leasePlan: {
    id: 'Item 7:p19',
    text: 'We expect to continue to enter into finance leases, primarily for data centers.',
  },
  leasePayments: {
    id: 'Item 7:p340',
    text: 'total undiscounted future lease payments under finance leases was $2.9 billion, of which $491 million is short-term.',
  },
  issuance: {
    id: 'Item 7:p137',
    text: '•In 2025, we issued senior unsecured notes for net proceeds of $37.3 billion, to be used for general corporate purposes.',
  },
};
const evidence = (p: { id: string; text: string }) => [
  { paragraphId: p.id, quote: p.text },
];
const note = (
  p: { id: string; text: string },
  text: string,
  kind: CapitalNote['kind'] = 'fact',
): CapitalNote => ({ text, kind, evidence: evidence(p) });
const content = (): AiResearchSummary['summaryJson'] => ({
  groups: TOPICS.mda.map((topic) => ({ topic, findings: [] })),
  capitalAllocation: emptyCapitalInformation(),
});
const modelConfig = () =>
  new ConfigService({
    ROUTER_API_KEY: 'mock-only',
    AI_MODEL: 'mock',
    ROUTER_BASE_URL: 'https://mock.example/v1',
    AI_ITEM_LIMITS_JSON: JSON.stringify({
      model: 'mock',
      provider: 'https://mock.example/v1',
      contextWindow: 128000,
      maxInputTokens: 64000,
      maxOutputTokens: 32000,
      byteFallbackTokenizer: true,
      source: 'Mock profile',
    }),
  });
beforeEach(() => jest.mocked(generateText).mockReset());
it('flags the saved liquidity-sufficiency statement for review, never invents risk or rewrites it', () => {
  const value = content();
  value.capitalAllocation!.debtAndFinancing.financingRisks = [
    note(
      source.liquidity,
      '公司认为资金足以覆盖未来需求，这是管理层预期，不是无条件保证。',
      'risk',
    ),
  ];
  const before = JSON.stringify(value);
  expect(reviewItem7Quality(value)).toEqual([
    expect.objectContaining({
      severity: 'review',
      code: 'LIQUIDITY_ASSESSMENT_NOT_EXPLICIT_RISK',
      fieldPath: 'capitalAllocation.debtAndFinancing.financingRisks[0]',
      paragraphIds: ['Item 7:p330'],
    }),
  ]);
  expect(() => validateNewItem7Quality(value)).not.toThrow();
  expect(JSON.stringify(value)).toBe(before);
});
it('allows an empty risk array and does not treat financing keywords or adequate liquidity plus explicit adverse financing evidence as absence of risk', () => {
  expect(reviewItem7Quality(content())).toEqual([]);
  const value = content();
  const p = {
    id: 'Item 7:p999',
    text: 'We may be unable to refinance debt at maturity.',
  };
  value.capitalAllocation!.debtAndFinancing.financingRisks = [
    {
      text: '存在明确披露的再融资风险。',
      kind: 'risk',
      evidence: [...evidence(source.liquidity), ...evidence(p)],
    },
  ];
  expect(reviewItem7Quality(value)).toEqual([]);
  value.capitalAllocation!.debtAndFinancing.financingRisks = [
    note(
      {
        id: 'Item 7:p998',
        text: 'Liquidity, debt and financing are discussed here.',
      },
      '融资相关说明。',
      'risk',
    ),
  ];
  expect(reviewItem7Quality(value)).toEqual([]); // no semantic certification from mere keywords
});
it('identifies standalone dividend/repurchase duplication but leaves financing uses and debt covenants intact', () => {
  const value = content();
  value.capitalAllocation!.debtAndFinancing.financingActivities = [
    {
      ...note(source.repurchases, '2025年回购并注销股份。'),
      activityType: 'other',
    },
    {
      ...note(source.dividends, '2025年现金分红金额。'),
      activityType: 'other',
    },
  ];
  expect(reviewItem7Quality(value).map((x) => x.code)).toEqual([
    'POSSIBLE_CAPITAL_RETURN_DUPLICATION',
    'POSSIBLE_CAPITAL_RETURN_DUPLICATION',
  ]);
  const linked = {
    id: 'Item 7:p990',
    text: 'Proceeds from issuance of debt were used to repurchase shares.',
  };
  const covenant = {
    id: 'Item 7:p991',
    text: 'Debt covenants restrict dividends and share repurchases.',
  };
  value.capitalAllocation!.debtAndFinancing.financingPurposes = [
    note(linked, '债务发行所得用于回购股份。'),
  ];
  value.capitalAllocation!.debtAndFinancing.financingTerms = [
    note(covenant, '债务条款限制股息分配及回购。'),
  ];
  expect(reviewItem7Quality(value)).toHaveLength(2);
  expect(
    value.capitalAllocation!.debtAndFinancing.financingPurposes,
  ).toHaveLength(1);
  expect(value.capitalAllocation!.debtAndFinancing.financingTerms).toHaveLength(
    1,
  );
});
it('flags the saved mixed lease plan/payment note, but keeps separately stated plans and balances', () => {
  const value = content();
  value.capitalAllocation!.debtAndFinancing.financingActivities = [
    {
      text: '预计继续订立数据中心融资租赁；年末未折现未来付款29亿美元。',
      kind: 'plan',
      activityType: 'plan',
      evidence: [
        ...evidence(source.leasePlan),
        ...evidence(source.leasePayments),
      ],
    },
  ];
  expect(reviewItem7Quality(value)[0]).toMatchObject({
    severity: 'review',
    code: 'MIXED_FINANCING_TIME_STATES',
  });
  value.capitalAllocation!.debtAndFinancing.financingActivities = [
    {
      ...note(source.leasePlan, '预计继续订立数据中心融资租赁。', 'plan'),
      activityType: 'plan',
    },
  ];
  value.capitalAllocation!.debtAndFinancing.financingTerms = [
    note(
      source.leasePayments,
      '年末未折现融资租赁未来付款29亿美元，不等于新增融资现金流或账面负债。',
    ),
  ];
  expect(reviewItem7Quality(value)).toEqual([]);
});
it.each([
  '本块未披露具体用途。',
  '该Chunk包含融资说明。',
  '当前Chunk已处理。',
  '发行取得373亿美元净 proceeds。',
])('blocks unambiguous internal/mixed-language narrative: %s', (text) => {
  const value = content();
  value.groups[1].findings = [
    { kind: '公司披露的事实', text, evidence: evidence(source.issuance) },
  ];
  expect(() => validateNewItem7Quality(value)).toThrow('自然中文');
  expect(reviewItem7Quality(value)[0].fieldPath).toBe(
    'groups[1].findings[0].text',
  );
});
it('keeps SEC quotes, raw consideration, professional terms and all other fields untouched', () => {
  const value = content();
  value.capitalAllocation!.reinvestment.investmentAreas = [
    note(source.issuance, 'CapEx、OCF、FCF及AI为保留的专业术语。'),
  ];
  const event: AcquisitionEvent = {
    targetName: 'Test',
    transactionDate: null,
    transactionValue: {
      rawText: 'net proceeds (原文表达)',
      currency: 'USD',
      scope: 'cash',
      evidence: evidence(source.issuance),
    },
    acquisitionPurpose: null,
    transactionStatus: 'pending',
    considerationType: 'cash',
    evidence: evidence(source.issuance),
  };
  value.capitalAllocation!.acquisitions.events = [event];
  const before = structuredClone(value);
  expect(reviewItem7Quality(value)).toEqual([]);
  expect(value).toEqual(before);
});
it('normal SEC quotation, financing, date and acquisition validation remains mandatory', () => {
  const value = content();
  value.capitalAllocation!.debtAndFinancing.financingActivities = [
    {
      ...note(source.issuance, '2025年发行高级无担保票据。'),
      activityType: 'actualFinancing',
    },
  ];
  expect(
    validateItemSummary(value, 'mda', [source.issuance], true),
  ).toBeDefined();
  value.capitalAllocation!.debtAndFinancing.financingActivities[0].evidence[0].quote =
    'Invented debt financing quote.';
  expect(() =>
    validateCapitalInformation(value.capitalAllocation, [source.issuance]),
  ).toThrow('逐字匹配');
});
it('new whole-Item generation rejects narrative artifacts once; semantic review findings are recorded without deleting facts', async () => {
  const value = content();
  value.capitalAllocation!.debtAndFinancing.financingRisks = [
    note(source.liquidity, '管理层认为现有资金足够满足需求。', 'risk'),
  ];
  const answer = {
    output: value,
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
    response: { modelId: 'mock' },
  };
  jest.mocked(generateText).mockResolvedValueOnce(answer as never);
  const result = await new SummaryModel(modelConfig()).generate(
    'mda',
    [source.liquidity],
    async () => {},
  );
  expect(result.usage.qualityReview?.[0].code).toBe(
    'LIQUIDITY_ASSESSMENT_NOT_EXPLICIT_RISK',
  );
  expect(
    result.summary.capitalAllocation?.debtAndFinancing.financingRisks,
  ).toHaveLength(1);
  value.groups[0].findings = [
    {
      kind: '公司披露的事实',
      text: '本块的经营说明。',
      evidence: evidence(source.liquidity),
    },
  ];
  jest
    .mocked(generateText)
    .mockClear()
    .mockResolvedValueOnce(answer as never);
  await expect(
    new SummaryModel(modelConfig()).generate(
      'mda',
      [source.liquidity],
      async () => {},
    ),
  ).rejects.toThrow('MDA_NARRATIVE_LANGUAGE');
  expect(generateText).toHaveBeenCalledTimes(1);
});
it.each(['item7-management-v1', 'item7-management-v2'])(
  'passive reads preserve %s with zero SEC/AI calls or cache writes',
  async (version) => {
    const legacy = {
      section: 'mda',
      accessionNumber: 'cached',
      fiscalYear: 2025,
      sourceUrl: 'https://www.sec.gov/cached',
      filingDate: '2026-02-05',
      promptVersion: version,
      summaryJson: content(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const before = JSON.stringify(legacy);
    const findFirst = jest.fn(async ({ where }) =>
      where.section === 'mda' && where.promptVersion.in?.includes(version)
        ? legacy
        : null,
    );
    const blocked = {
      generate: jest.fn(),
      getJson: jest.fn(),
      getText: jest.fn(),
    };
    const service = new AiResearchService(
      {
        aiSummary: { findFirst },
        aiTask: { findUnique: jest.fn().mockResolvedValue(null) },
      } as never,
      {} as never,
      blocked as never,
      blocked as never,
    );
    const state = await service.state('0001652044', 'management');
    expect(
      (
        state.summary
          ?.summaryJson as unknown as AiResearchSummary['summaryJson']
      ).capitalAllocation,
    ).toEqual(legacy.summaryJson.capitalAllocation);
    expect(
      (
        state.summary
          ?.summaryJson as unknown as AiResearchSummary['summaryJson']
      ).itemSources?.find((s) => s.item === 'Item 7')?.promptVersion,
    ).toBe(version);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(blocked.generate).not.toHaveBeenCalled();
    expect(blocked.getJson).not.toHaveBeenCalled();
    expect(promptVersionFor('mda')).toBe('item7-management-v3');
    expect(promptVersionFor('business')).toBe('business-model-v4');
    expect(promptVersionFor('risks')).toBe('item1a-risks-v1');
  },
);
it('v1 Item7 cache counts as existing initialization data and never causes an automatic paid regeneration', async () => {
  const service = new CompanyUpdateService(
    {
      company: { findUnique: jest.fn().mockResolvedValue({ cik: '1' }) },
      aiSummary: {
        findMany: jest.fn(async ({ where }) =>
          where.OR.some(
            (v: { section: string; promptVersion: { in?: string[] } }) =>
              v.section === 'mda' &&
              v.promptVersion.in?.includes('item7-management-v1'),
          )
            ? [
                { section: 'business' },
                { section: 'mda' },
                { section: 'risks' },
              ]
            : [],
        ),
      },
      aiTask: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never,
    {} as never,
    {} as never,
  );
  expect((await service.start('1', 'INITIAL')).status).toBe('IDLE');
});
