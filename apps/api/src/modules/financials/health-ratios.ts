import { isObject } from './annual-financials';
import type { FinancialPeriod } from '@company-research/shared';
const tags = ['us-gaap:InterestExpenseNonoperating', 'us-gaap:InterestExpense'];
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const day = 86400000;
export function healthRatios(
  row: {
    operatingIncome: number | null;
    totalDebt: number | null;
    cash: number | null;
    periodStart: string;
    periodEnd: string;
    sources: unknown;
  },
  baseline: unknown,
): Pick<
  FinancialPeriod,
  'netDebt' | 'interestCoverage' | 'interestCoverageDetails'
> {
  const s = isObject(row.sources) ? row.sources : {};
  const policy = isObject(s.financialHealthPolicy)
    ? s.financialHealthPolicy
    : {};
  const instant = (v: unknown) =>
    isObject(v) &&
    Array.isArray(v.items) &&
    v.items.length > 0 &&
    v.items.every(
      (x: unknown) =>
        isObject(x) &&
        x.end === row.periodEnd &&
        x.unit === 'USD' &&
        x.accn === policy.snapshotAccession &&
        x.filed === policy.snapshotFiled,
    );
  const netDebt =
    policy.version === 2 &&
    policy.missingDebt === null &&
    finite(row.totalDebt) &&
    finite(row.cash) &&
    instant(s.totalDebt) &&
    instant(s.cash)
      ? row.totalDebt - row.cash
      : null;
  const result: NonNullable<FinancialPeriod['interestCoverageDetails']> = {
    policyVersion: 'operating-income-interest-v1',
    status: 'MISSING_DATA',
    reason: '缺少同期间可靠的总利息费用；不采用TTM合计、净利息或现金付息',
    operatingIncome: row.operatingIncome,
    interestExpense: null,
    sources: [],
  };
  const b = isObject(baseline) ? baseline : {};
  const envelope = isObject(s.annualRoicInputs)
    ? s.annualRoicInputs
    : isObject(s.quarterlyRoicInputs)
      ? s.quarterlyRoicInputs
      : {};
  const sic = typeof envelope.sic === 'string' ? envelope.sic : null;
  if (sic && /^(60|61|62|63|64|65|66|67)/.test(sic)) {
    result.status = 'NOT_APPLICABLE';
    result.reason = '金融企业暂不适用普通经营企业利息保障倍数';
    return { netDebt, interestCoverage: null, interestCoverageDetails: result };
  }
  if (!sic || !/^\d{4}$/.test(sic)) {
    result.reason = '缺少SEC行业分类，无法确认公式适用性';
    return { netDebt, interestCoverage: null, interestCoverageDetails: result };
  }
  const interest =
    b.cik === envelope.cik && isObject(b.interest) ? b.interest : {};
  const facts = (Array.isArray(interest.items) ? interest.items : []).filter(
    (x): x is Record<string, unknown> =>
      isObject(x) &&
      tags.includes(String(x.concept)) &&
      x.unit === 'USD' &&
      finite(x.val) &&
      typeof x.start === 'string' &&
      typeof x.end === 'string' &&
      typeof x.filed === 'string' &&
      /^\d{10}-\d{2}-\d{6}$/.test(String(x.accn)) &&
      /^10-[KQ](\/A)?$/.test(String(x.form)) &&
      Number.isFinite(Date.parse(x.start)) &&
      Number.isFinite(Date.parse(x.end)) &&
      Number.isFinite(Date.parse(x.filed)) &&
      new Date(x.filed).toISOString().slice(0, 10) === x.filed &&
      x.start < x.end &&
      x.filed >= x.end &&
      x.filed <= new Date().toISOString().slice(0, 10) &&
      (x.dimensions === undefined ||
        (isObject(x.dimensions) && Object.keys(x.dimensions).length === 0)),
  );
  const choose = (start: string, end: string) => {
    const xs = facts.filter((f) => f.start === start && f.end === end);
    if (!xs.length) return undefined;
    // Conflicting reported values or overlapping gross definitions need review.
    if (xs.some((f) => f.val !== xs[0].val)) return null;
    return xs.sort((a, b) => String(b.filed).localeCompare(String(a.filed)))[0];
  };
  const selected = choose(row.periodStart, row.periodEnd);
  let expense: number | null = null;
  let evidence: Record<string, unknown>[] = [];
  if (selected) {
    expense = selected.val as number;
    evidence = [selected];
  } else if (selected === undefined) {
    const duration =
      (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / day + 1;
    if (duration >= 60 && duration <= 110) {
      const previousEnd = new Date(Date.parse(row.periodStart) - day)
        .toISOString()
        .slice(0, 10);
      const candidates = facts.filter(
        (f) => f.end === row.periodEnd && String(f.start) < row.periodStart,
      );
      const pairs = candidates.flatMap((c) => {
        const p = choose(String(c.start), previousEnd);
        return p &&
          p.concept === c.concept &&
          String(p.filed) <= String(c.filed)
          ? [{ c, p, value: (c.val as number) - (p.val as number) }]
          : [];
      });
      if (pairs.length && pairs.every((p) => p.value === pairs[0].value)) {
        expense = pairs[0].value;
        evidence = [pairs[0].c, pairs[0].p];
      }
    }
  }
  if (selected === null) {
    result.status = 'REVIEW_REQUIRED';
    result.reason = '同期间利息费用披露存在冲突';
  }
  result.interestExpense = expense;
  result.sources = evidence;
  const op = isObject(s.operatingIncome) ? s.operatingIncome : {};
  const items = Array.isArray(op.items) ? op.items : [];
  const validOp =
    finite(row.operatingIncome) &&
    items.length > 0 &&
    items.every(
      (x: unknown) =>
        isObject(x) &&
        x.unit === 'USD' &&
        x.concept === 'us-gaap:OperatingIncomeLoss',
    ) &&
    ((op.method === 'reported' &&
      items.length === 1 &&
      items[0].start === row.periodStart &&
      items[0].end === row.periodEnd &&
      items[0].val === row.operatingIncome) ||
      (op.method === 'ytd_difference' &&
        items.length === 2 &&
        items[0].start === items[1].start &&
        items[0].end === row.periodEnd &&
        items[1].end ===
          new Date(Date.parse(row.periodStart) - day)
            .toISOString()
            .slice(0, 10) &&
        finite(items[0].val) &&
        finite(items[1].val) &&
        items[0].val - items[1].val === row.operatingIncome));
  const cachedOp =
    isObject(b.ebit) && Array.isArray(b.ebit.items) ? b.ebit.items : [];
  const opConflict = cachedOp.some(
    (x: unknown) =>
      isObject(x) &&
      x.start === row.periodStart &&
      x.end === row.periodEnd &&
      finite(x.val) &&
      x.val !== row.operatingIncome,
  );
  let value: number | null = null;
  if (expense !== null) {
    if (expense <= 0) {
      result.reason = '利息费用为零或负数，不计算利息保障倍数';
      result.status = 'INVALID_INPUT';
    } else if (!validOp || opConflict) {
      result.reason = '营业利润缺失或期间来源未核准';
      result.status = 'REVIEW_REQUIRED';
    } else {
      const ratio = row.operatingIncome! / expense;
      if (finite(ratio)) {
        value = ratio;
        result.status = 'READY';
        result.reason = null;
      }
    }
  }
  return { netDebt, interestCoverage: value, interestCoverageDetails: result };
}
