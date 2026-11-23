import { BUSINESS_MODEL_TOPICS } from '@company-research/shared';
import { z } from 'zod';
import {
  ExtractionValidationError,
  locateValidationError,
} from './validation-diagnostics';
import type { ExtractionKind } from './item-extraction';
import { ITEM_FOR } from './item-extraction';
import type { Paragraph } from './filing-parser';
import {
  capitalInformationSchema,
  validateCapitalInformation,
} from './capital-information';
export const TOPICS = {
  business: BUSINESS_MODEL_TOPICS,
  mda: ['经营表现与变化原因', '资金使用与重大决策', '未来经营重点与趋势'],
  risks: ['重大风险'],
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
const businessSummarySchema = summarySchema.extend({
  groups: z.array(summarySchema.shape.groups.element).length(3),
});
const managementSummarySchema = summarySchema.extend({
  capitalAllocation: capitalInformationSchema.optional(),
});
const mdaSummarySchema = managementSummarySchema.extend({
  groups: z.array(summarySchema.shape.groups.element).length(3),
});
const riskFindingSchema =
  summarySchema.shape.groups.element.shape.findings.element.extend({
    riskType: z.string().min(1).max(200),
    impact: z.string().min(1).max(1200).nullable(),
  });
const riskSummarySchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            topic: z.literal('重大风险'),
            findings: z.array(riskFindingSchema).max(40),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();
export function validateItemSummary(
  value: unknown,
  kind: ExtractionKind,
  paragraphs: Paragraph[],
  requireCapital = false,
) {
  if (paragraphs.some((p) => !p.id.startsWith(ITEM_FOR[kind] + ':')))
    throw new Error('Item输入边界不匹配');
  if (kind === 'business') return validateSummary(value, kind, paragraphs);
  if (kind === 'mda') {
    const parsed = mdaSummarySchema.parse(value);
    const checked = validateSummary(
      {
        ...parsed,
        groups: [...parsed.groups, { topic: '重大风险', findings: [] }],
      },
      'management',
      paragraphs,
      requireCapital,
    );
    return { ...checked, groups: checked.groups.slice(0, 3) };
  }
  const parsed = riskSummarySchema.parse(value);
  // Reuse the exact quotation, language and evidence rules of the existing risk validator.
  for (const risk of parsed.groups[0].findings) {
    const { riskType: _type, impact: _impact, ...finding } = risk;
    void _type;
    void _impact;
    try {
      validateSummary(
        {
          groups: [
            ...TOPICS.mda.map((topic) => ({ topic, findings: [] })),
            { topic: '重大风险', findings: [finding] },
          ],
        },
        'management',
        paragraphs,
      );
    } catch (error) {
      if (error instanceof ExtractionValidationError)
        throw new ExtractionValidationError(
          error.fieldPath.replace(/^groups\[3\]/, 'groups[0]'),
          error.errorType,
          error.paragraphIds,
          error.message,
        );
      throw error;
    }
  }
  for (const finding of parsed.groups[0].findings) {
    if (
      !/[\u4e00-\u9fff]/u.test(finding.riskType) ||
      (finding.impact !== null && !/[\u4e00-\u9fff]/u.test(finding.impact))
    )
      throw new Error('风险类型和影响必须为中文');
    if (finding.evidence.some((e) => !e.paragraphId.startsWith('Item 1A:')))
      throw new Error('风险只允许引用Item 1A');
  }
  return parsed;
}
export function validateSummary(
  value: unknown,
  kind: 'business' | 'management',
  paragraphs: Paragraph[],
  requireCapital = false,
) {
  const result = (
    kind === 'business' ? businessSummarySchema : managementSummarySchema
  ).parse(value);
  if (kind === 'management') {
    const capital =
      'capitalAllocation' in result ? result.capitalAllocation : undefined;
    if (requireCapital && !capital)
      throw new Error('新版管理层输出缺少资本配置结构');
    if (capital) validateCapitalInformation(capital, paragraphs);
  }
  const source = new Map(paragraphs.map((p) => [p.id, p.text]));
  if (result.groups.length !== TOPICS[kind].length)
    throw new Error('摘要栏目数量不匹配');
  if (result.groups.some((g, i) => g.topic !== TOPICS[kind][i]))
    throw new Error('摘要栏目不匹配');
  if (
    kind === 'business' &&
    result.groups[0].findings.some((f) => !f.businessName)
  )
    throw new Error('业务介绍必须包含官方业务名称');
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
    for (const [findingIndex, finding] of group.findings.entries()) {
      try {
        if (kind === 'business') {
          if (finding.kind === 'AI 推断')
            throw new Error('商业模式只接受有依据的披露事实与管理层观点');
          const bodies = [
            finding.text,
            finding.offering,
            finding.monetization,
          ].filter((x): x is string => x !== undefined);
          if (
            bodies.some((text) =>
              /[$€£¥￥]\s*\d|\b(?:USD|EUR|CNY)\s*\d|\d[\d,.]*\s*(?:万亿|千亿|百亿|十亿|亿|千万|百万|万)?\s*(?:美元|美金|人民币|元|%|％)/iu.test(
                text,
              ),
            )
          )
            throw new Error('商业模式不展示具体财务金额或百分比');
        }
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
      } catch (error) {
        throw locateValidationError(
          error,
          `groups[${index}].findings[${findingIndex}]`,
          finding.evidence.map((e) => e.paragraphId),
        );
      }
    }
  return result;
}
