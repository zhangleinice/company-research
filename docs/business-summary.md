# Business summary v3

Business now has four ordered questions: company offering/customers, business model, competitive advantages, growth opportunities. The business model uses an evidence-backed array of actual business units with official `businessName`, plain Chinese `offering` and `monetization`. No issuer-specific business structure is prescribed. Empty findings are permitted when evidence is insufficient. The existing Item 1 extraction, paragraph IDs and exact-quote validation remain in use; Business cannot cite Item 7 or Item 1A.

The dedicated Business prompt emphasizes short natural Chinese, explaining technical terms, no product lists or duplicated financial figures, no unsupported forecasts, and distinguishing facts, company assertions and analysis. This is a generation instruction, not a claim that every model output can be semantically proven by automated validation. References must match original text; business fields are validated for required content and Chinese explanations.

Management retains its five topics, existing prompt text, model configuration and `sec-research-v2` cache version. Business uses `business-model-v3`. No Prisma schema change is required: summaries remain JSON stored under the existing company/accession/section/promptVersion unique key.

## Existing caches and paid calls

- Passive Business reads prefer v3, falling back to v2. They never generate or write summaries.
- Old summaries are displayed under four headings without the old risk group. They are explicitly labeled as legacy content, not presented as newly generated commercial-model output. Missing fields are not invented.
- Initialization recognizes old and new Business caches alongside the unchanged management cache. Non-forced generation can reuse an old Business cache for the same accession, preventing the version change itself from creating a paid migration.
- Only an explicit existing full update (`force=true`) regenerates v3. The old version remains stored separately. The top-level update behavior remains unchanged, including its existing management refresh behavior when the user explicitly requests a full update.
- No bulk backfill, automatic paid cache migration or real provider invocation was performed for validation.

Validation: typecheck, lint, full tests and builds passed. Mock tests cover dynamic business counts, four-section enforcement, evidence scope/exact quotes, required commercial-model fields, legacy passive reads/non-forced reuse and explicit versioned persistence. React rendering tests cover new unit cards, limited classification badges, citations and legacy risk removal. Management and financial regression tests remain enabled.
