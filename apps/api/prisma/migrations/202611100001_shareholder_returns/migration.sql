ALTER TABLE "annual_financials"
  ADD COLUMN "dilutedShares" DECIMAL(32,8),
  ADD COLUMN "basicShares" DECIMAL(32,8),
  ADD COLUMN "dilutedSharesGrowth" DECIMAL(32,8);
ALTER TABLE "quarterly_financials"
  ADD COLUMN "dilutedShares" DECIMAL(32,8),
  ADD COLUMN "basicShares" DECIMAL(32,8),
  ADD COLUMN "dilutedSharesGrowth" DECIMAL(32,8);
