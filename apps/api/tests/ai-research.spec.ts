import {
  extractSections,
  latest10K,
} from '../src/modules/ai-research/filing-parser';
import {
  validateSummary,
  TOPICS,
} from '../src/modules/ai-research/summary-schema';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import type { SecService } from '../src/modules/sec/sec.service';
import type { SecClient } from '../src/modules/sec/sec.client';
import type { SummaryModel } from '../src/modules/ai-research/summary-model';

const paragraph =
  'A specific disclosed business fact about products and customers. '.repeat(
    40,
  );
function html() {
  return `<html><body><div>Table of Contents</div><p>Item 1. Business</p><p>4</p><p>Item 1A. Risk Factors</p><p>8</p><p>Item 7. Management’s Discussion and Analysis</p><p>48</p><p>Item 8. Financial Statements</p><p>Item 1. Business</p><p>${paragraph}</p><p>Item 1A. Risk Factors</p><p>${paragraph} RISK-END</p><p>Item 1B. Unresolved Staff Comments</p><p>none</p><p>Item 7. Management’s Discussion and Analysis</p><p>${paragraph} MDA-END</p><p>Item 7A. Market Risk</p><p>UNRELATED</p></body></html>`;
}
describe('10-K sections and grounded JSON', () => {
  it('rejects TOC and ends at intervening items', () => {
    const result = extractSections(html());
    expect(result['Item 1'][0].text).toContain('specific disclosed');
    expect(result['Item 1A'].at(-1)?.text).toContain('RISK-END');
    expect(result['Item 7'].at(-1)?.text).toContain('MDA-END');
    expect(JSON.stringify(result)).not.toContain('UNRELATED');
    expect(JSON.stringify(result)).not.toContain('Table of Contents');
  });
  it('preserves table cell boundaries and removes hidden metadata', () => {
    const result = extractSections(
      html().replace(
        `<p>${paragraph}</p>`,
        `<table><tr><td>2025</td><td>1,647</td><td>USD millions</td></tr></table><p>${paragraph}</p><div style="display:none">HIDDEN FACT</div>`,
      ),
    );
    expect(JSON.stringify(result)).toContain('2025 | 1,647 | USD millions |');
    expect(JSON.stringify(result)).not.toContain('HIDDEN FACT');
  });
  it('fails closed for absent, short or ambiguous content', () => {
    expect(() => extractSections('<p>Item 1. Business</p>')).toThrow();
    expect(() => extractSections(html() + html())).toThrow();
  });
  it('only selects complete 10-K reports and validates path and CIK', () => {
    const data = {
      cik: 1652044,
      filings: {
        recent: {
          form: ['10-Q', '10-K/A', '10-K'],
          accessionNumber: ['a', 'b', '0001652044-26-000018'],
          primaryDocument: ['a', 'b', 'goog-20251231.htm'],
          reportDate: ['2026-09-30', '2025-12-31', '2025-12-31'],
          filingDate: ['2026-10-01', '2026-03-01', '2026-02-05'],
        },
      },
    };
    expect(latest10K(data, '0001652044').sourceUrl).toBe(
      'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm',
    );
    expect(() => latest10K(data, '0000320193')).toThrow();
    data.filings.recent.primaryDocument[2] = '../../bad.htm';
    expect(() => latest10K(data, '0001652044')).toThrow();
  });
  it('validates Chinese, exact quotes, classification and topic completeness', () => {
    const value = {
      groups: TOPICS.business.map((topic) => ({ topic, findings: [] })),
    } as {
      groups: {
        topic: string;
        findings: {
          kind: string;
          text: string;
          evidence: { paragraphId: string; quote: string }[];
        }[];
      }[];
    };
    value.groups[0].findings.push({
      kind: '公司披露的事实',
      text: '公司披露产品业务。',
      evidence: [
        { paragraphId: 'Item 1:p1', quote: 'specific disclosed business fact' },
      ],
    });
    expect(
      validateSummary(value, 'business', [
        { id: 'Item 1:p1', text: paragraph },
      ]),
    ).toEqual(value);
    value.groups[0].findings[0].evidence[0].quote =
      'invented unsupported source';
    expect(() =>
      validateSummary(value, 'business', [
        { id: 'Item 1:p1', text: paragraph },
      ]),
    ).toThrow();
  });
});
describe('AI cache and duplicate prevention', () => {
  const create = () => {
    const db = {
      aiFiling: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { upsert: jest.fn() },
      aiTask: {
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aiSummary: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const sec = {
      resolveCompany: jest.fn().mockResolvedValue({
        cik: '0001652044',
        ticker: 'GOOGL',
        name: 'Alphabet',
      }),
    };
    const client = {
      getJson: jest.fn().mockResolvedValue({
        cik: 1652044,
        filings: {
          recent: {
            form: ['10-K'],
            accessionNumber: ['0001652044-26-000018'],
            primaryDocument: ['goog.htm'],
            reportDate: ['2025-12-31'],
            filingDate: ['2026-02-05'],
          },
        },
      }),
      getText: jest.fn(),
    };
    const model = { generate: jest.fn() };
    const service = new AiResearchService(
      db as unknown as PrismaService,
      sec as unknown as SecService,
      client as unknown as SecClient,
      model as unknown as SummaryModel,
    );
    return { db, client, model, service };
  };
  it('does not call SEC or AI on passive cache reads', async () => {
    const { service, client, model } = create();
    expect((await service.state('0001652044', 'business')).status).toBe(
      'NOT_GENERATED',
    );
    expect(client.getJson).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });
  it('returns same filing/prompt cache without downloading or paid AI', async () => {
    const { service, db, client, model } = create();
    db.aiSummary.findUnique.mockResolvedValue({
      id: 'cached',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await service.generate('GOOGL', 'business', false)).cached).toBe(
      true,
    );
    expect(client.getText).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });
  it('blocks duplicate workers before SEC or AI calls', async () => {
    const { service, db, client, model } = create();
    db.aiTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.generate('GOOGL', 'business', false)).rejects.toThrow(
      '正在生成',
    );
    expect(client.getJson).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });
  it('releases a failed extraction task for retries without AI', async () => {
    const { service, db, client, model } = create();
    client.getText.mockResolvedValue('<p>invalid filing</p>');
    await expect(service.generate('GOOGL', 'business', false)).rejects.toThrow(
      '提取失败',
    );
    expect(db.aiTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', token: null }),
      }),
    );
    expect(model.generate).not.toHaveBeenCalled();
  });
});
