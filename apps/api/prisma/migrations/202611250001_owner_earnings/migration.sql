CREATE TABLE "owner_earnings_estimates" (
    "id" TEXT NOT NULL,
    "companyCik" VARCHAR(10) NOT NULL,
    "periodEnd" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "owner_earnings_estimates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "owner_earnings_estimates_companyCik_periodEnd_key" ON "owner_earnings_estimates"("companyCik", "periodEnd");
ALTER TABLE "owner_earnings_estimates" ADD CONSTRAINT "owner_earnings_estimates_companyCik_fkey" FOREIGN KEY ("companyCik") REFERENCES "companies"("cik") ON DELETE RESTRICT ON UPDATE CASCADE;
