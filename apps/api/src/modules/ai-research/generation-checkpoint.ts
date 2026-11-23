import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AiResearchSummary } from '@company-research/shared';
import { z } from 'zod';
import { compatibleValidationUpgrade } from './checkpoint-validation-compatibility';
import {
  diagnosticSchema,
  type ValidationDiagnostic,
} from './validation-diagnostics';
export type GeneratedSummary = AiResearchSummary['summaryJson'];
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => [key, canonical(v)]),
        )
      : value;
export const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const validationFingerprint = () =>
  digest([
    readFileSync(require.resolve('./summary-schema'), 'utf8'),
    readFileSync(require.resolve('./capital-information'), 'utf8'),
    readFileSync(require.resolve('./item-extraction'), 'utf8'),
    readFileSync(require.resolve('./financing-facts'), 'utf8'),
    readFileSync(require.resolve('./item7-quality'), 'utf8'),
  ]);
export interface GenerationSource {
  cik: string;
  filingId?: string;
  accessionNumber: string;
  parserVersion: string;
  inputHash: string;
  item?: 'Item 1' | 'Item 1A' | 'Item 7';
}
export interface CheckpointIO {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}
export interface GenerationExecution {
  source: GenerationSource;
  checkpoint: CheckpointIO;
  signal: AbortSignal;
}
const tokens = z.number().int().nonnegative().nullable();
const attemptSchema = z.object({
  id: z.string(),
  runId: z.string(),
  identityHash: z.string(),
  phase: z.enum(['chunk', 'merge', 'whole-item']),
  chunk: z.number().int().nullable(),
  startedAt: z.string(),
  elapsedMs: z.number().nonnegative().nullable(),
  status: z.enum(['running', 'succeeded', 'failed', 'unknown']),
  inputTokens: tokens,
  outputTokens: tokens,
  model: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  providerResponseId: z.string().nullable(),
  error: z.string().nullable(),
  diagnostics: z.array(diagnosticSchema).max(8).optional(),
});
const stepSchema = z.object({
  inputHash: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
  output: z.unknown().optional(),
  outputHash: z.string().optional(),
  diagnostics: z.array(diagnosticSchema).max(8).optional(),
});
const checkpointSchema = z.object({
  version: z.literal(1),
  identityHash: z.string(),
  identity: z.record(z.string(), z.unknown()),
  plan: z
    .array(
      z.object({
        index: z.number().int(),
        inputHash: z.string(),
        paragraphIds: z.array(z.string()),
      }),
    )
    .max(32),
  steps: z.record(z.string(), stepSchema),
  attempts: z.array(attemptSchema),
});
export type GenerationAttempt = z.infer<typeof attemptSchema>;
export type GenerationCheckpointData = z.infer<typeof checkpointSchema>;
export interface GenerationUsage {
  runId: string;
  newRequests: number;
  reusedChunks: number;
  reusedMerge: boolean;
  reusedWholeItem: boolean;
  knownInputTokens: number;
  knownOutputTokens: number;
  unknownUsageRequests: number;
  historicalKnownInputTokens: number;
  historicalKnownOutputTokens: number;
  historicalUnknownUsageRequests: number;
}
/** One active plan and a bounded request ledger; no intermediate result is an AiSummary. */
export class GenerationCheckpoint {
  private data!: GenerationCheckpointData;
  readonly runId = randomUUID();
  private reusedChunks = 0;
  private reusedMerge = false;
  private reusedWholeItem = false;
  constructor(private readonly io: CheckpointIO) {}
  async prepare(
    identity: Record<string, unknown>,
    plan: GenerationCheckpointData['plan'],
    revalidate?: (value: unknown, key: string) => GeneratedSummary,
  ) {
    const parsed = checkpointSchema.safeParse(await this.io.load());
    const identityHash = digest(identity);
    const old = parsed.success ? parsed.data : undefined;
    const intact =
      old &&
      digest(old.identity) === old.identityHash &&
      digest(old.plan) === digest(plan);
    const { schemaHash: _oldSchema, ...oldIdentity } = old?.identity ?? {};
    void _oldSchema;
    const { schemaHash: _newSchema, ...newIdentity } = identity;
    void _newSchema;
    const upgrade = Boolean(
      intact &&
      revalidate &&
      compatibleValidationUpgrade(
        old!.identity.schemaHash,
        identity.schemaHash,
      ) &&
      digest(oldIdentity) === digest(newIdentity),
    );
    if (intact && (old!.identityHash === identityHash || upgrade)) {
      this.data = old!;
      if (upgrade) {
        for (const [key, step] of Object.entries(this.data.steps))
          if (step.status === 'succeeded') {
            try {
              if (step.outputHash !== digest(step.output))
                throw Error('检查点内容哈希不匹配');
              revalidate!(structuredClone(step.output), key);
            } catch {
              this.data.steps[key] = {
                inputHash: step.inputHash,
                status: 'pending',
              };
            }
          }
        this.data.identity = identity;
        this.data.identityHash = identityHash;
      }
    } else
      this.data = {
        version: 1,
        identityHash,
        identity,
        plan,
        steps: Object.fromEntries(
          plan.map((p) => [
            identity.strategy === 'whole-item-v1'
              ? 'whole-item'
              : `chunk-${p.index}`,
            { inputHash: p.inputHash, status: 'pending' as const },
          ]),
        ),
        attempts: old?.attempts ?? [],
      };
    // A prior process may have disappeared without receiving an HTTP result.
    for (const a of this.data.attempts)
      if (a.status === 'running') {
        a.status = 'unknown';
        a.elapsedMs = Math.max(0, Date.now() - Date.parse(a.startedAt));
        a.error = '上次执行中断，上游完成及费用未知';
        if (a.identityHash === identityHash) {
          const key =
            a.phase === 'whole-item'
              ? 'whole-item'
              : a.phase === 'merge'
                ? 'merge'
                : `chunk-${a.chunk}`;
          const step = this.data.steps[key];
          if (step?.status !== 'succeeded')
            this.data.steps[key] = {
              inputHash: step?.inputHash ?? '',
              status: 'unknown',
            };
        }
      }
    await this.flush();
  }
  async reuse(
    key: string,
    inputHash: string,
    validate: (value: unknown) => GeneratedSummary,
  ): Promise<GeneratedSummary | undefined> {
    const s = this.data.steps[key];
    if (s?.status !== 'succeeded' || s.inputHash !== inputHash)
      return undefined;
    try {
      if (s.outputHash !== digest(s.output))
        throw Error('检查点内容哈希不匹配');
      const result = validate(structuredClone(s.output));
      if (key === 'whole-item') this.reusedWholeItem = true;
      else if (key === 'merge') this.reusedMerge = true;
      else this.reusedChunks++;
      return structuredClone(result);
    } catch {
      this.data.steps[key] = { inputHash, status: 'pending' };
      await this.flush();
      return undefined;
    }
  }
  async begin(key: string, inputHash: string, chunk: number | null) {
    const a: GenerationAttempt = {
      id: randomUUID(),
      runId: this.runId,
      identityHash: this.data.identityHash,
      phase:
        key === 'whole-item'
          ? 'whole-item'
          : chunk === null
            ? 'merge'
            : 'chunk',
      chunk,
      startedAt: new Date().toISOString(),
      elapsedMs: null,
      status: 'running',
      inputTokens: null,
      outputTokens: null,
      model: null,
      providerRequestId: null,
      providerResponseId: null,
      error: null,
    };
    this.data.attempts.push(a);
    this.data.steps[key] = { inputHash, status: 'pending' };
    await this.flush();
    return a;
  }
  async success(
    key: string,
    inputHash: string,
    output: GeneratedSummary,
    attempt?: GenerationAttempt,
  ) {
    if (attempt) {
      attempt.status = 'succeeded';
      attempt.elapsedMs = Math.max(
        0,
        Date.now() - Date.parse(attempt.startedAt),
      );
    }
    this.data.steps[key] = {
      inputHash,
      status: 'succeeded',
      output: structuredClone(output),
      outputHash: digest(output),
    };
    await this.flush();
  }
  async failure(
    key: string,
    inputHash: string,
    attempt: GenerationAttempt,
    status: 'failed' | 'unknown',
    error: string,
    diagnostics?: ValidationDiagnostic[],
  ) {
    attempt.status = status;
    attempt.error = error;
    if (diagnostics?.length) attempt.diagnostics = diagnostics;
    attempt.elapsedMs = Math.max(0, Date.now() - Date.parse(attempt.startedAt));
    this.data.steps[key] = {
      inputHash,
      status,
      ...(diagnostics?.length ? { diagnostics } : {}),
    };
    await this.flush();
  }
  usage(): GenerationUsage {
    const now = this.data.attempts.filter((a) => a.runId === this.runId),
      past = this.data.attempts.filter((a) => a.runId !== this.runId);
    const sum = (xs: GenerationAttempt[], k: 'inputTokens' | 'outputTokens') =>
      xs.reduce((n, a) => n + (a[k] ?? 0), 0);
    const unknown = (xs: GenerationAttempt[]) =>
      xs.filter((a) => a.inputTokens === null || a.outputTokens === null)
        .length;
    return {
      runId: this.runId,
      newRequests: now.length,
      reusedChunks: this.reusedChunks,
      reusedMerge: this.reusedMerge,
      reusedWholeItem: this.reusedWholeItem,
      knownInputTokens: sum(now, 'inputTokens'),
      knownOutputTokens: sum(now, 'outputTokens'),
      unknownUsageRequests: unknown(now),
      historicalKnownInputTokens: sum(past, 'inputTokens'),
      historicalKnownOutputTokens: sum(past, 'outputTokens'),
      historicalUnknownUsageRequests: unknown(past),
    };
  }
  completed() {
    return this.data.plan.filter(
      (p) => this.data.steps[`chunk-${p.index}`]?.status === 'succeeded',
    ).length;
  }
  private async flush() {
    if (Buffer.byteLength(JSON.stringify(this.data), 'utf8') > 4 * 1024 * 1024)
      throw Error('AI检查点超过4MiB安全上限，未继续请求');
    await this.io.save(structuredClone(this.data));
  }
}
