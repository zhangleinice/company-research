import type { CompanyDetail, FinancialPeriod } from '@company-research/shared';
export function managementPeriods(
  detail: Pick<CompanyDetail, 'annual'>,
): FinancialPeriod[] {
  return [...detail.annual]
    .filter((row) => {
      const days =
        (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000 +
        1;
      return (
        row.fiscalQuarter === null &&
        days >= 330 &&
        days <= 400 &&
        Date.parse(row.periodEnd) < Date.now()
      );
    })
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .slice(0, 10);
}
