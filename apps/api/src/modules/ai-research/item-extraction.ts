import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { Item, Paragraph } from './filing-parser';
export type ExtractionKind = 'business' | 'mda' | 'risks';
export const ITEM_FOR: Record<ExtractionKind, Item> = {
  business: 'Item 1',
  mda: 'Item 7',
  risks: 'Item 1A',
};
export const ITEM_PROMPT_VERSIONS = {
  business: 'business-model-v4',
  mda: 'item7-management-v3',
  risks: 'item1a-risks-v1',
} as const;
/** Estimates are diagnostics only, never used as a context-window guarantee. */
export function tokenEstimate(system: string, paragraphs: Paragraph[]) {
  const input = system + '\n' + JSON.stringify(paragraphs);
  let ascii = 0,
    nonAscii = 0;
  for (const c of input) {
    if (c.codePointAt(0)! <= 127) ascii++;
    else nonAscii++;
  }
  return {
    characters: input.length,
    estimatedTokens: Math.ceil(ascii / 3.5 + nonAscii),
    utf8TokenUpperBound: Buffer.byteLength(input, 'utf8') + 1024,
  };
}
/** Keep complete paragraphs where possible, then prefer sentence/whitespace boundaries. */
export function itemParagraphs(originals: Paragraph[]): Paragraph[] {
  return originals.flatMap((p) => {
    if (p.text.length <= 18000) return [{ ...p }];
    const parts: Paragraph[] = [];
    let offset = 0;
    while (offset < p.text.length) {
      let end = Math.min(offset + 18000, p.text.length);
      if (end < p.text.length) {
        const text = p.text.slice(offset, end);
        const boundaries = [...text.matchAll(/[.!?]\s+|\n+|\s+/g)];
        const last = boundaries.at(-1);
        if (last && last.index! > 9000)
          end = offset + last.index! + last[0].length;
      }
      parts.push({
        id: `${p.id}:part${parts.length + 1}`,
        text: p.text.slice(offset, end),
      });
      offset = end;
    }
    return parts;
  });
}
const limitsSchema = z
  .object({
    model: z.string(),
    provider: z.string().url(),
    contextWindow: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxWholeInputTokens: z.number().int().positive(),
    byteFallbackTokenizer: z.literal(true),
    wholeOutputBudgetValidated: z.literal(true),
    source: z.string().min(1),
  })
  .strict();
export function planItem(
  config: ConfigService,
  kind: ExtractionKind,
  paragraphs: Paragraph[],
  system: string,
  model: string,
  provider: string,
) {
  const item = ITEM_FOR[kind];
  if (
    !paragraphs.length ||
    paragraphs.some((p) => !p.id.startsWith(item + ':'))
  )
    throw new Error(`${item}只允许使用自身原文`);
  let limits: z.infer<typeof limitsSchema> | undefined;
  try {
    limits = limitsSchema.parse(
      JSON.parse(config.get<string>('AI_ITEM_LIMITS_JSON') || 'null'),
    );
  } catch {
    /* Unconfirmed limits always fall back to existing bounded chunks. */
  }
  if (
    limits &&
    (limits.model !== model ||
      limits.provider.replace(/\/$/, '') !== provider.replace(/\/$/, ''))
  )
    limits = undefined;
  const confirmedInputLimit = limits
    ? Math.min(limits.maxInputTokens, limits.contextWindow - 8000)
    : null;
  if (limits && (limits.maxOutputTokens < 8000 || confirmedInputLimit! <= 0))
    throw new Error('已确认的模型限制不足以容纳当前输出预算，未调用AI');
  const estimate = tokenEstimate(system, paragraphs);
  const whole = Boolean(
    limits &&
    limits.model === model &&
    limits.provider.replace(/\/$/, '') === provider.replace(/\/$/, '') &&
    limits.maxOutputTokens >= 8000 &&
    estimate.utf8TokenUpperBound <= limits.maxInputTokens &&
    estimate.utf8TokenUpperBound <= limits.maxWholeInputTokens &&
    estimate.utf8TokenUpperBound + 8000 <= limits.contextWindow &&
    JSON.stringify(paragraphs).length < 170000,
  );
  const chunks: Paragraph[][] = [];
  if (whole) chunks.push(paragraphs);
  else
    for (const p of paragraphs) {
      let chunk = chunks.at(-1);
      if (
        !chunk ||
        JSON.stringify(chunk).length + JSON.stringify(p).length > 24000
      ) {
        chunk = [];
        chunks.push(chunk);
      }
      chunk.push(p);
    }
  if (
    confirmedInputLimit !== null &&
    chunks.some(
      (chunk) =>
        tokenEstimate(system, chunk).utf8TokenUpperBound > confirmedInputLimit,
    )
  )
    throw new Error('单块超过已确认的模型输入限制，未调用AI或截断原文');
  if (chunks.length > 32) throw new Error('章节超出有效分块范围，未截断内容');
  return {
    item,
    chunks,
    mode: whole ? 'whole-item' : 'item-chunks',
    estimate,
    limitsSource: whole ? limits!.source : null,
    confirmedInputLimit,
  };
}
