-- Remove only legacy DPS values populated from issuer-specific narrative disclosures.
-- Keep all CompanyFacts observations, financial rows, favorites and AI data intact.
UPDATE "annual_financials"
SET "dividendsPerShare" = NULL, "dpsGrowth" = NULL,
    "sources" = "sources" - 'dividendsPerShare' - 'dpsGrowth'
WHERE "sources"->'dividendsPerShare'->>'method' = 'verified_disclosure';
UPDATE "quarterly_financials"
SET "dividendsPerShare" = NULL, "dpsGrowth" = NULL,
    "sources" = "sources" - 'dividendsPerShare' - 'dpsGrowth'
WHERE "sources"->'dividendsPerShare'->>'method' = 'verified_disclosure';
