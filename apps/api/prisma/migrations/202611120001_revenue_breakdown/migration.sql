CREATE TABLE "revenue_breakdown_cache" (
  "companyCik" VARCHAR(10) PRIMARY KEY REFERENCES "companies"("cik") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'NOT_FETCHED',
  "accessionNumber" TEXT, "sourceUrl" TEXT, "fiscalYear" INTEGER, "reportDate" TEXT,
  "parserVersion" TEXT, "data" JSONB NOT NULL DEFAULT '[]',
  "extractedAt" TIMESTAMP(3), "checkedAt" TIMESTAMP(3), "fetchToken" TEXT,
  "leaseUntil" TIMESTAMP(3), "lastError" TEXT
);
