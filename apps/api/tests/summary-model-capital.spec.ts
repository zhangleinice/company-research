import { generateText } from 'ai';
import { ConfigService } from '@nestjs/config';
import { SummaryModel } from '../src/modules/ai-research/summary-model';
import { TOPICS } from '../src/modules/ai-research/summary-schema';
import { emptyCapitalInformation } from '../src/modules/ai-research/capital-information';
import type { AcquisitionEvent } from '@company-research/shared';
jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { json: () => ({}) },
  APICallError: { isInstance: () => false },
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => ({}) }),
}));
const groups = () => TOPICS.mda.map((topic) => ({ topic, findings: [] }));
const answer = (output: unknown) => ({
  output,
  usage: { inputTokens: 1, outputTokens: 1 },
  response: { modelId: 'mock' },
  finishReason: 'stop',
});
const quote = (i: number) =>
  `In March 2025, we entered into a definitive agreement to acquire Target${i} for $10 billion in an all-cash transaction. The acquisition is expected to close in 2026.`;
const event = (i: number, id: string): AcquisitionEvent => {
  const evidence = [{ paragraphId: id, quote: quote(i) }];
  return {
    targetName: `Target${i}`,
    transactionDate: {
      value: '2025-03',
      precision: 'month',
      type: 'agreement',
      evidence,
    },
    transactionValue: {
      rawText: '$10 billion',
      currency: 'USD',
      scope: 'cash',
      evidence,
    },
    transactionStatus: 'pending',
    considerationType: 'cash',
    acquisitionPurpose: null,
    evidence,
  };
};
it('one shared map/reduce task preserves all capital events instead of selecting five or calling each Section', async () => {
  const ps = [
    {
      id: 'Item 7:p1',
      text:
        Array.from({ length: 6 }, (_, i) => quote(i)).join(' ') +
        ' '.repeat(13000),
    },
    { id: 'Item 7:p2', text: quote(0) + ' '.repeat(13500) },
  ];
  const a = emptyCapitalInformation();
  a.acquisitions.events = Array.from({ length: 6 }, (_, i) =>
    event(i, ps[0].id),
  );
  const b = emptyCapitalInformation();
  b.acquisitions.events = [event(0, ps[1].id)];
  jest
    .mocked(generateText)
    .mockReset()
    .mockResolvedValueOnce(
      answer({ groups: groups(), capitalAllocation: a }) as never,
    )
    .mockResolvedValueOnce(
      answer({ groups: groups(), capitalAllocation: b }) as never,
    )
    .mockResolvedValueOnce(answer({ groups: groups() }) as never);
  const result = await new SummaryModel(
    new ConfigService({ ROUTER_API_KEY: 'mock-only' }),
  ).generateLegacyChunks('mda', ps, async () => {});
  const capital = (
    'capitalAllocation' in result.summary
      ? result.summary.capitalAllocation
      : undefined
  )!;
  expect(capital.acquisitions.events).toHaveLength(6);
  expect(capital.acquisitions.events[0].evidence).toHaveLength(2);
  expect(generateText).toHaveBeenCalledTimes(3);
  expect(result.usage.calls).toBe(3);
  expect(jest.mocked(generateText).mock.calls[2][0].prompt).not.toContain(
    'Target0',
  );
});
it('rejects quotations from other chunks even if they occur elsewhere in the complete filing', async () => {
  const a = emptyCapitalInformation();
  a.acquisitions.events = [event(0, 'Item 7:p2')];
  jest
    .mocked(generateText)
    .mockReset()
    .mockResolvedValue(
      answer({ groups: groups(), capitalAllocation: a }) as never,
    );
  await expect(
    new SummaryModel(
      new ConfigService({ ROUTER_API_KEY: 'mock-only' }),
    ).generateLegacyChunks(
      'mda',
      [
        { id: 'Item 7:p1', text: 'Other information. '.repeat(900) },
        { id: 'Item 7:p2', text: quote(0) + ' '.repeat(13000) },
      ],
      async () => {},
    ),
  ).rejects.toThrow('逐字匹配');
});
