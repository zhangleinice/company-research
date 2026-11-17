CREATE TABLE "merger_deals" (
  "id" TEXT PRIMARY KEY,
  "companyName" TEXT NOT NULL,
  "symbol" TEXT,
  "cik" TEXT,
  "targetedCompanyName" TEXT NOT NULL,
  "targetedSymbol" TEXT,
  "targetedCik" TEXT,
  "transactionDate" VARCHAR(10) NOT NULL,
  "acceptedDate" TEXT,
  "link" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "merger_deals_transactionDate_id_idx" ON "merger_deals"("transactionDate", "id");
CREATE TABLE "merger_imports" (
  "id" TEXT PRIMARY KEY,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
