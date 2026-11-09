import { z } from 'zod';
import type { Paragraph } from './filing-parser';
export const TOPICS = {
  business: [
    '公司主要业务',
    '主要业务板块',
    '竞争优势',
    '增长机会',
    '业务依赖与风险',
  ],
  management: [
    '经营表现及原因',
    '资本开支',
    '现金流与融资',
    '未来经营重点',
    '主要风险',
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
              .max(5),
          })
          .strict(),
      )
      .length(5),
  })
  .strict();
export function validateSummary(
  value: unknown,
  kind: SummaryKind,
  paragraphs: Paragraph[],
) {
  const result = summarySchema.parse(value);
  const source = new Map(paragraphs.map((p) => [p.id, p.text]));
  if (result.groups.some((g, i) => g.topic !== TOPICS[kind][i]))
    throw new Error('摘要栏目不匹配');
  for (const group of result.groups)
    for (const finding of group.findings) {
      if (!/[\u4e00-\u9fff]/u.test(finding.text))
        throw new Error('摘要必须为中文');
      for (const e of finding.evidence)
        if (!source.get(e.paragraphId)?.includes(e.quote))
          throw new Error('摘要引用无法匹配原始段落');
    }
  return result;
}
