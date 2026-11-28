import type {
  AnnualRoicHistory,
  AnnualRoicResult,
  EnterpriseQuality,
  FinancialMode,
  FinancialPeriod,
  QuarterlyRoicHistory,
  QuarterlyRoicResult,
  RoicIssue,
} from '@company-research/shared';
export type RoicResult = AnnualRoicResult | QuarterlyRoicResult;
export type RoicHistory = AnnualRoicHistory | QuarterlyRoicHistory;
export function roicHistory(
  data: EnterpriseQuality | null | undefined,
  mode: FinancialMode,
): RoicHistory | undefined {
  return mode === 'annual' ? data?.annualRoic : data?.quarterlyRoic;
}
export function matchRoic(
  row: FinancialPeriod | undefined,
  history: RoicHistory | undefined,
  mode: FinancialMode,
): RoicResult | undefined {
  if (!row) return undefined;
  const matches =
    history?.results.filter(
      (r) =>
        r.periodStart === row.periodStart &&
        r.periodEnd === row.periodEnd &&
        r.fiscalYear === row.fiscalYear &&
        r.currency === row.currency &&
        (mode === 'annual'
          ? !('fiscalQuarter' in r)
          : 'fiscalQuarter' in r && r.fiscalQuarter === row.fiscalQuarter),
    ) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}
export function roicValue(result: RoicResult | undefined): number | null {
  return result?.status === 'READY' &&
    typeof result.roic === 'number' &&
    Number.isFinite(result.roic)
    ? result.roic
    : null;
}
/** Presentation conversion only: API ratios are decimals; existing chart percentages use percentage points. */
export function roicPercent(result: RoicResult | undefined): number | null {
  const value = roicValue(result);
  return value === null ? null : value * 100;
}
export function roicReasons(
  result: RoicResult | undefined,
  history: RoicHistory | undefined,
): RoicIssue[] {
  if (result) return result.missingReasons;
  if (!history)
    return [
      {
        code: 'ROIC_CACHE_MISSING',
        field: 'roic',
        message: '旧数据尚未刷新：当前缓存没有新版 ROIC 数据。',
      },
    ];
  return [
    ...history.missingReasons,
    {
      code: 'ROIC_PERIOD_MISSING',
      field: 'period',
      message: '当前完整报告期间没有匹配的 ROIC 结果，未使用更早期间替代。',
    },
  ];
}
export function roicStatus(
  result: RoicResult | undefined,
  history: RoicHistory | undefined,
): string {
  if (result?.status === 'NOT_APPLICABLE') return '不适用';
  if (result?.status === 'INVALID_INPUT') return '异常输入';
  if (roicValue(result) !== null) return '已核准';
  const reasons = roicReasons(result, history);
  if (reasons.some((r) => /CACHE_VERSION|ROIC_CACHE_MISSING/.test(r.code)))
    return '旧数据尚未刷新';
  if (
    reasons.some((r) =>
      /FINANCING_DEBT_SCOPE|CAPITAL_UNVERIFIED|CAPITAL_COMPONENT_MISSING/.test(
        r.code,
      ),
    )
  )
    return '未核准';
  return '输入缺失';
}
