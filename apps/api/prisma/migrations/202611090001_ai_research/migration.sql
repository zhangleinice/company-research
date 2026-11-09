-- CreateTable
CREATE TABLE "ai_filings" (
    "id" TEXT NOT NULL,
    "companyCik" VARCHAR(10) NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "filingType" TEXT NOT NULL DEFAULT '10-K',
    "filingDate" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" TEXT NOT NULL,
    "companyCik" VARCHAR(10) NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "filingType" TEXT NOT NULL DEFAULT '10-K',
    "filingDate" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "usage" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tasks" (
    "id" TEXT NOT NULL,
    "companyCik" VARCHAR(10) NOT NULL,
    "section" TEXT NOT NULL,
    "token" TEXT,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_filings_companyCik_accessionNumber_parserVersion_key" ON "ai_filings"("companyCik", "accessionNumber", "parserVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ai_summaries_companyCik_accessionNumber_section_promptVersi_key" ON "ai_summaries"("companyCik", "accessionNumber", "section", "promptVersion");

-- AddForeignKey
ALTER TABLE "ai_filings" ADD CONSTRAINT "ai_filings_companyCik_fkey" FOREIGN KEY ("companyCik") REFERENCES "companies"("cik") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_companyCik_fkey" FOREIGN KEY ("companyCik") REFERENCES "companies"("cik") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tasks" ADD CONSTRAINT "ai_tasks_companyCik_fkey" FOREIGN KEY ("companyCik") REFERENCES "companies"("cik") ON DELETE RESTRICT ON UPDATE CASCADE;

