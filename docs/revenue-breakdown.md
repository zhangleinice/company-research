# Revenue Breakdown V1 integration

Revenue Breakdown is displayed before Business prose. It keeps the verified original row-oriented tables separate, preserves row order and names (including totals/adjustments), displays up to three fiscal years and same-row comparable YoY, and links back to original SEC facts. It does not aggregate, classify, infer hierarchy, chart, fill missing amounts or use AI. Empty or unavailable data does not replace Business text.

## One parser, exact storage

The verified numeric/context and table parsing sources now live in `apps/api/src/modules/revenue/parser/`. Validation scripts re-export those files, so production and validation cannot drift. CommonJS assets are copied by Nest build; TypeScript declarations describe the boundary. The supported rules and skip behavior remain those documented in `docs/validation/revenue-breakdown-stage2.md`.

One `revenue_breakdown_cache` row per CIK stores filing identity, status, parser version, extraction/check times, and the complete ordered source groups in JSONB. Monetary USD values are exact integer **strings**, never JavaScript floating-point amounts. Context, unit, dimensions, fact ID/source position and comparable-period evidence remain with each fact. Frontend million-USD formatting uses BigInt and preserves up to six decimal places exactly. No existing financial columns or AI summary data were removed.

The complete JSON result is committed by one PostgreSQL update guarded by an acquisition token and unexpired lease. There are no independently committed child rows. A CIK primary key, conditional acquisition lease and re-read after acquisition prevent concurrent duplicate or partial imports. Failed refreshes retain the old result; a failed first extraction remains retryable through explicit update.

## Requests and refresh

- `GET /api/companies/:cik/revenue-breakdown` reads cached results. A company detail record must already exist.
- Missing data is acquired once, independently of AI. READY, EMPTY and FAILED checks are cached; FAILED is not retried by repeated ordinary visits. An interrupted first acquisition can reclaim an expired lease.
- The existing full update invokes the existing 10-K preparation path. Revenue processing captures the same HTML before Item extraction; failure is isolated from Business/Management processing.
- Submissions and HTML requests are shared concurrently and kept in memory for 20 seconds only; raw HTML is not stored in PostgreSQL. Acquisition uses the existing SEC client.
- Identical accession + parser version + completed extraction skips re-parsing, including EMPTY results. A parser-version change is considered on explicit refresh, not automatically on page access.
- Before parsing, document type, period end and entity CIK are checked against the expected filing. Plain ISO and the observed English displayed period-end dates are accepted for identity matching. Parser amount/context rules have not been broadened.
- Revenue failures log a safe CIK-specific server message and preserve any valid cache. Technical stacks are not returned by the revenue response or displayed in Business.

This integration does not call the AI model or change prompts. The existing top-level full-update operation retains its existing AI behavior when a user explicitly requests it; this feature introduces no additional AI calls.

## Verification performed

Applied the additive Prisma migration. Imported only the already-cached Alphabet, Apple and Nvidia HTML into the new revenue cache, without SEC requests. Business/Management summary fingerprints were unchanged.

| Company | Filing | Original tables | Rows |
| --- | --- | ---: | ---: |
| Alphabet | 0001652044-26-000018 | 3 | 21 |
| Apple | 0000320193-26-000026 | 3 | 13 |
| Nvidia | 0001045810-26-000021 | 2 | 13 |

- Parser fixtures and three cached filings: `node --test scripts/revenue-validation/*.test.cjs`.
- Isolated disposable database schema (never resets the application schema): `node --test scripts/revenue-integration.test.cjs`. Covers exact persisted groups, cache hits with a forbidden-network client, same-accession skips, concurrency, failed refresh preservation, first failure/manual retry and EMPTY caching.
- `node scripts/verify-revenue-api.cjs`: compares the actual NestJS response, Vite proxy and PostgreSQL JSON for all three CIKs, verifies representative annual amounts, renders each group through the real React table component, and checks unchanged AI summary fingerprints.
- Typecheck, lint, full unit/HTTP regression tests and builds. Unit tests also cover shared metadata/HTML requests, invalid CIK and safe cached reads. Web tests verify exact formatting beyond Number.MAX_SAFE_INTEGER, original group separation, null/zero, growth and source links.

No live browser layout acceptance is claimed; frontend acceptance used actual persisted API responses rendered with React. No real AI generation or full company update was triggered during validation.

## Operational scripts

`node scripts/seed-revenue-cache.cjs` is an explicit import of the three local acceptance caches only; it is not called by the application. `node scripts/verify-revenue-api.cjs` performs GET/read-only verification. These scripts expect the previously retained files in `/tmp/revenue-breakdown-validation/`.
