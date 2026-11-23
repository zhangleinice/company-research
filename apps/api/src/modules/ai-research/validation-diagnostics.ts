import { z } from 'zod';
import type { Item } from './filing-parser';
export const diagnosticSchema = z.object({
  item: z.enum(['Item 1', 'Item 1A', 'Item 7']),
  chunk: z.number().int().positive().nullable(),
  phase: z.enum(['chunk', 'merge', 'whole-item']),
  fieldPath: z.string().max(240),
  errorType: z.string().max(80),
  paragraphIds: z.array(z.string().max(100)).max(12),
  reason: z.string().max(300),
});
export type ValidationDiagnostic = z.infer<typeof diagnosticSchema>;
export class ExtractionValidationError extends Error {
  constructor(
    readonly fieldPath: string,
    readonly errorType: string,
    readonly paragraphIds: string[],
    reason: string,
  ) {
    super(reason);
    this.name = 'ExtractionValidationError';
  }
}
export function locateValidationError(
  error: unknown,
  path: string,
  paragraphIds: string[],
  errorType = 'BUSINESS_RULE_VIOLATION',
): ExtractionValidationError {
  return error instanceof ExtractionValidationError
    ? error
    : new ExtractionValidationError(
        path,
        errorType,
        paragraphIds,
        error instanceof Error ? error.message : '结构化结果校验失败',
      );
}
const formatPath = (path: PropertyKey[]) =>
  path.reduce<string>(
    (s, key) =>
      typeof key === 'number'
        ? `${s}[${key}]`
        : `${s ? `${s}.` : ''}${String(key)}`,
    '',
  ) || '$';
function paragraphIdsAt(output: unknown, path: PropertyKey[]): string[] {
  const parents: unknown[] = [output];
  let value = output;
  for (const key of path) {
    if (!value || typeof value !== 'object') break;
    value = (value as Record<PropertyKey, unknown>)[key];
    parents.push(value);
  }
  for (const candidate of parents.reverse())
    if (candidate && typeof candidate === 'object' && 'evidence' in candidate) {
      const evidence = (candidate as { evidence: unknown }).evidence;
      if (Array.isArray(evidence))
        return evidence.flatMap((e) =>
          e && typeof e === 'object' && typeof e.paragraphId === 'string'
            ? [e.paragraphId]
            : [],
        );
    }
  return [];
}
/** Never persist raw model output or quotes. Only bounded, redacted failure coordinates. */
export function validationDiagnostics(
  error: unknown,
  output: unknown,
  item: Item,
  chunk: number | null,
  secret: string,
  phase?: ValidationDiagnostic['phase'],
): ValidationDiagnostic[] {
  const redact = (s: string) =>
    s
      .replaceAll(secret || '\0UNCONFIGURED', '[REDACTED]')
      .replace(/sk-[\w-]+/g, '[REDACTED]');
  const base = {
    item,
    chunk,
    phase: phase ?? (chunk === null ? ('merge' as const) : ('chunk' as const)),
  };
  const issues =
    error instanceof ExtractionValidationError
      ? [
          {
            fieldPath: error.fieldPath,
            errorType: error.errorType,
            paragraphIds: error.paragraphIds,
            reason: error.message,
          },
        ]
      : error instanceof z.ZodError
        ? error.issues.slice(0, 8).map((issue) => {
            const path = [...issue.path];
            if (
              ['reinvestment', 'acquisitions', 'debtAndFinancing'].includes(
                String(path[0]),
              )
            )
              path.unshift('capitalAllocation');
            return {
              fieldPath: formatPath(path),
              errorType: 'SCHEMA_VALIDATION',
              paragraphIds: paragraphIdsAt(output, path),
              reason: issue.message,
            };
          })
        : [
            {
              fieldPath: '$',
              errorType:
                output === undefined
                  ? 'REQUEST_FAILURE'
                  : 'GENERATION_OR_VALIDATION_FAILURE',
              paragraphIds: [],
              reason:
                error instanceof Error ? error.message : 'AI请求或校验失败',
            },
          ];
  return issues.map((issue) => ({
    ...base,
    fieldPath: redact(issue.fieldPath).slice(0, 240),
    errorType: issue.errorType.slice(0, 80),
    paragraphIds: [...new Set(issue.paragraphIds)]
      .filter((id) => /^Item (?:1|1A|7):p\d+(?::part\d+)?$/.test(id))
      .slice(0, 12)
      .map((id) => id.slice(0, 100)),
    reason: redact(issue.reason).slice(0, 300),
  }));
}
export function diagnosticMessage(d: ValidationDiagnostic) {
  return `${d.item} ${d.phase === 'whole-item' ? '完整Item' : d.chunk === null ? '合并' : `Chunk ${d.chunk}`} ${d.fieldPath} [${d.errorType}] ${d.paragraphIds.join(',') || '无段落ID'}：${d.reason}`;
}
