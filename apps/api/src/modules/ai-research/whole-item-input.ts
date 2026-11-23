import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Paragraph } from './filing-parser';
import {
  ITEM_FOR,
  tokenEstimate,
  type ExtractionKind,
} from './item-extraction';
export const WHOLE_ITEM_STRATEGY = 'whole-item-v1';
export const wholeItemTaskId = (cik: string, item: string) =>
  `${cik}:${item}:whole-item`;
export function maxOutputTokensFor(
  config: ConfigService,
  kind: ExtractionKind,
) {
  const suffix = { business: 'ITEM_1', risks: 'ITEM_1A', mda: 'ITEM_7' }[kind];
  const value = Number(
    config.get(`AI_MAX_OUTPUT_TOKENS_${suffix}`) ??
      config.get('AI_MAX_OUTPUT_TOKENS') ??
      32000,
  );
  if (!Number.isInteger(value) || value < 1 || value > 128000)
    throw new ServiceUnavailableException(
      'AI_MAX_OUTPUT_TOKENS及各Item覆盖值必须为1至128000的整数',
    );
  return value;
}
const confirmedLimits = z
  .object({
    model: z.string(),
    provider: z.string().url(),
    contextWindow: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    byteFallbackTokenizer: z.literal(true),
    source: z.string().min(1),
    maxWholeInputTokens: z.number().int().positive().optional(),
    wholeOutputBudgetValidated: z.boolean().optional(),
  })
  .strict();
/** No fallback to chunks: unknown service limits fail closed before a paid request. */
export function planWholeItem(
  config: ConfigService,
  kind: ExtractionKind,
  paragraphs: Paragraph[],
  system: string,
  model: string,
  provider: string,
  maxOutputTokens: number,
) {
  const item = ITEM_FOR[kind];
  if (
    !paragraphs.length ||
    paragraphs.some((p) => !p.id.startsWith(item + ':')) ||
    new Set(paragraphs.map((p) => p.id)).size !== paragraphs.length
  )
    throw new Error(`${item}只允许使用自身完整且段落ID唯一的原文`);
  const prefix = `以下是完整${item}原文及段落ID。一次性提取预定义结构，保留有依据的信息及逐字引用，不补充未披露内容。\n`;
  const prompt = prefix + JSON.stringify(paragraphs);
  const estimate = tokenEstimate(system + '\n' + prefix, paragraphs);
  const parsed = confirmedLimits.safeParse(
    (() => {
      try {
        return JSON.parse(config.get<string>('AI_ITEM_LIMITS_JSON') || 'null');
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success)
    throw new ServiceUnavailableException(
      `完整${item}请求未发送：Router上下文及输出限制尚未确认，请配置已核实的AI_ITEM_LIMITS_JSON；估算输入${estimate.estimatedTokens} Token，预留输出${maxOutputTokens} Token`,
    );
  const limits = parsed.data;
  if (
    limits.model !== model ||
    limits.provider.replace(/\/$/, '') !== provider.replace(/\/$/, '')
  )
    throw new ServiceUnavailableException(
      '完整Item请求未发送：已确认限制与当前模型或Router不匹配',
    );
  const inputLimit = Math.min(
    limits.maxInputTokens,
    limits.contextWindow - maxOutputTokens,
    limits.maxWholeInputTokens ?? Infinity,
  );
  if (
    maxOutputTokens > limits.maxOutputTokens ||
    estimate.utf8TokenUpperBound > inputLimit
  )
    throw new ServiceUnavailableException(
      `完整${item}请求超过已确认的上下文／输入／输出限制，未发送请求或截断原文（保守输入上界${estimate.utf8TokenUpperBound} Token，输出预算${maxOutputTokens} Token）`,
    );
  return {
    item,
    chunks: [paragraphs],
    prompt,
    mode: 'whole-item' as const,
    estimate,
    limitsSource: limits.source,
    confirmedInputLimit: inputLimit,
  };
}
