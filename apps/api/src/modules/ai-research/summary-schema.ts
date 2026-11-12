import { z } from 'zod';
import type { Paragraph } from './filing-parser';
export const TOPICS = {
  business: [
    '公司做什么？',
    '公司怎么赚钱？',
    '公司有什么竞争优势？',
    '未来有哪些增长机会？',
  ],
  management: [
    '经营表现与变化原因',
    '资金使用与重大决策',
    '未来经营重点与趋势',
    '重大风险',
  ],
} as const;
export type SummaryKind = keyof typeof TOPICS;
export const summarySchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            topic: z.string(),
            findings: z
              .array(
                z
                  .object({
                    kind: z.enum(['公司披露的事实', '管理层观点', 'AI 推断']),
                    text: z.string().min(1).max(1200),
                    businessName: z.string().min(1).max(200).optional(),
                    offering: z.string().min(1).max(1200).optional(),
                    monetization: z.string().min(1).max(1200).optional(),
                    evidence: z
                      .array(
                        z
                          .object({
                            paragraphId: z.string(),
                            quote: z.string().min(12).max(1500),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(12),
                  })
                  .strict(),
              )
              .max(40),
          })
          .strict(),
      )
      .min(4)
      .max(5),
  })
  .strict();
export function validateSummary(
  value: unknown,
  kind: SummaryKind,
  paragraphs: Paragraph[],
) {
  const result = summarySchema.parse(value);
  const source = new Map(paragraphs.map((p) => [p.id, p.text]));
  if (result.groups.length !== TOPICS[kind].length)
    throw new Error('摘要栏目数量不匹配');
  if (result.groups.some((g, i) => g.topic !== TOPICS[kind][i]))
    throw new Error('摘要栏目不匹配');
  if (
    kind === 'business' &&
    result.groups[1].findings.some(
      (f) => !f.businessName || !f.offering || !f.monetization,
    )
  )
    throw new Error('业务板块必须包含官方名称、做什么和怎么赚钱');
  if (
    kind === 'management' &&
    result.groups.some(
      (g) =>
        g.findings.length > 5 ||
        g.findings.some((f) => f.businessName || f.offering || f.monetization),
    )
  )
    throw new Error('管理层摘要结构不匹配');
  for (const [index, group] of result.groups.entries())
    for (const finding of group.findings) {
      if (
        [finding.text, finding.offering, finding.monetization]
          .filter((x): x is string => x !== undefined)
          .some((x) => !/[\u4e00-\u9fff]/u.test(x))
      )
        throw new Error('摘要必须为中文');
      if (
        kind === 'management' &&
        index === 3 &&
        !finding.evidence.some((e) => e.paragraphId.startsWith('Item 1A:'))
      )
        throw new Error('重大风险必须引用 Item 1A');
      for (const e of finding.evidence)
        if (
          (kind === 'business' && !e.paragraphId.startsWith('Item 1:')) ||
          (kind === 'management' &&
            !(index < 3
              ? e.paragraphId.startsWith('Item 7:')
              : /^(Item 7|Item 1A):/.test(e.paragraphId))) ||
          !source.get(e.paragraphId)?.includes(e.quote)
        )
          throw new Error('摘要引用无法匹配原始段落');
    }
  return result;
}
