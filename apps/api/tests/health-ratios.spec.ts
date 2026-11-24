import { healthRatios } from '../src/modules/financials/health-ratios';
const fact = (value: number, start = '2025-01-01', end = '2025-12-31') => ({
  val: value,
  start,
  end,
  accn: '0000000001-26-000001',
  filed: '2026-02-01',
  form: '10-K',
  unit: 'USD',
  concept: 'us-gaap:InterestExpenseNonoperating',
});
const row = () => ({
  operatingIncome: 100,
  totalDebt: 50,
  cash: 100,
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  sources: {
    annualRoicInputs: { sic: '7372', cik: '0000000001' },
    financialHealthPolicy: {
      version: 2,
      missingDebt: null,
      snapshotAccession: '0000000001-26-000001',
      snapshotFiled: '2026-02-01',
    },
    cash: { items: [{ ...fact(100), start: undefined }] },
    totalDebt: { items: [{ ...fact(50), start: undefined }] },
    operatingIncome: {
      method: 'reported',
      items: [{ ...fact(100), concept: 'us-gaap:OperatingIncomeLoss' }],
    },
  },
});
const baseline = (items: unknown[]) => ({
  cik: '0000000001',
  interest: { value: 999999, items },
});
it('uses gross reported interest operands only, not TTM total; retains cash-only negative net debt', () => {
  expect(healthRatios(row(), baseline([fact(8)]))).toMatchObject({
    netDebt: -50,
    interestCoverage: 12.5,
  });
});
it.each([0, -1])('nonpositive interest %s stays null', (n) => {
  expect(healthRatios(row(), baseline([fact(n)])).interestCoverage).toBeNull();
});
it('allows operating losses and preserves full precision', () => {
  const r = row();
  r.operatingIncome = -100;
  r.sources.operatingIncome.items[0].val = -100;
  expect(healthRatios(r, baseline([fact(3)])).interestCoverage).toBe(-100 / 3);
});
it('rejects unapproved debt, missing cash, conflicting interest, net interest and cash interest', () => {
  const r = row();
  r.sources.financialHealthPolicy.missingDebt = 'unapproved' as unknown as null;
  expect(healthRatios(r, baseline([])).netDebt).toBeNull();
  for (const concept of [
    'us-gaap:InterestPaidNet',
    'us-gaap:InterestIncomeExpenseNonoperatingNet',
    'us-gaap:InterestExpenseDebt',
  ])
    expect(
      healthRatios(row(), baseline([{ ...fact(8), concept }])).interestCoverage,
    ).toBeNull();
  expect(
    healthRatios(row(), baseline([fact(8), fact(9)])).interestCoverage,
  ).toBeNull();
});
it('excludes financial enterprises and requires matching company identity', () => {
  const r = row();
  r.sources.annualRoicInputs.sic = '6020';
  expect(
    healthRatios(r, baseline([fact(8)])).interestCoverageDetails?.status,
  ).toBe('NOT_APPLICABLE');
  expect(
    healthRatios(row(), { ...baseline([fact(8)]), cik: '0000000002' })
      .interestCoverage,
  ).toBeNull();
});
it('derives Q4 from exact cumulative periods and refuses YTD itself for Q3', () => {
  const r = row();
  r.periodStart = '2025-10-01';
  r.sources.operatingIncome.items[0].start = r.periodStart;
  const b = baseline([fact(40), fact(30, '2025-01-01', '2025-09-30')]);
  expect(healthRatios(r, b).interestCoverage).toBe(10);
  r.periodStart = '2025-07-01';
  r.periodEnd = '2025-09-30';
  expect(healthRatios(r, b).interestCoverage).toBeNull();
});
