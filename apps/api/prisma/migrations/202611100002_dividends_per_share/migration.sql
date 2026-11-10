ALTER TABLE "annual_financials"
  ADD COLUMN "dividendsPerShare" DECIMAL(32,8),
  ADD COLUMN "dpsGrowth" DECIMAL(32,8);
ALTER TABLE "quarterly_financials"
  ADD COLUMN "dividendsPerShare" DECIMAL(32,8),
  ADD COLUMN "dpsGrowth" DECIMAL(32,8);
