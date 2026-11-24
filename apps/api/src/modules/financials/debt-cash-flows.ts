import type { FinancialPeriod } from '@company-research/shared';
import { isObject } from './annual-financials';

// Aggregate short- and long-term cash flows only. Never sum these with their
// components, net short-term borrowing, balances, facilities or lease payments.
// Issuance taxonomy definition: https://www.sec.gov/Archives/edgar/data/914122/000143774924038265/R49.htm
// Repayment excludes lease obligations: https://www.sec.gov/Archives/edgar/data/1903595/000121390025117512/R39.htm
export const DEBT_CASH_FLOW_TAGS = {
  debtIssuance: 'ProceedsFromIssuanceOfDebt',
  debtRepayments: 'RepaymentsOfDebt',
} as const;

export function debtCashFlowSources(
  taxonomy: Record<string, unknown>,
  period: Pick<FinancialPeriod, 'periodStart' | 'periodEnd'>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(DEBT_CASH_FLOW_TAGS).map(([key, tag]) => {
      const concept = taxonomy[tag];
      const units =
        isObject(concept) && isObject(concept.units) ? concept.units : {};
      const items = Array.isArray(units.USD)
        ? units.USD.filter(isObject).filter(
            (f) =>
              f.start === period.periodStart &&
              f.end === period.periodEnd &&
              /^10-K(\/A)?$/.test(String(f.form)) &&
              (f.fp === undefined || f.fp === 'FY') &&
              typeof f.filed === 'string' &&
              /^\d{4}-\d{2}-\d{2}$/.test(f.filed) &&
              Number.isFinite(Date.parse(f.filed)) &&
              new Date(f.filed).toISOString().slice(0, 10) === f.filed &&
              f.filed >= period.periodEnd &&
              typeof f.accn === 'string' &&
              /^\d{10}-\d{2}-\d{6}$/.test(f.accn) &&
              typeof f.val === 'number' &&
              Number.isFinite(f.val) &&
              f.val >= 0 &&
              (f.dimensions === undefined ||
                (isObject(f.dimensions) &&
                  Object.keys(f.dimensions).length === 0)),
          )
        : [];
      // Latest comparative/amended annual disclosure wins for this exact period;
      // conflicting values in that filing are ambiguous and remain missing.
      items.sort(
        (a, b) =>
          String(b.filed).localeCompare(String(a.filed)) ||
          String(b.accn).localeCompare(String(a.accn)),
      );
      const latest = items[0];
      const sameFiling = latest
        ? items.filter(
            (f) => f.filed === latest.filed && f.accn === latest.accn,
          )
        : [];
      const selected =
        latest && new Set(sameFiling.map((f) => f.val)).size === 1
          ? latest
          : undefined;
      return [
        key,
        selected
          ? {
              method: 'reported',
              items: [{ ...selected, concept: `us-gaap:${tag}`, unit: 'USD' }],
            }
          : {
              method: 'unavailable',
              items: [],
              reason: latest
                ? '同一申报的债务现金流汇总值冲突，无法确认'
                : '未找到同一完整财年的有效USD债务现金流汇总披露；不以分项、净额或余额估算',
            },
      ];
    }),
  );
}
