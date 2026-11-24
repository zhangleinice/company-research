import { normalizeCompanyFacts } from '../src/modules/financials/normalize-company-facts';
import { annualCapitalAllocation } from '../src/modules/financials/capital-allocation';

const observation = (val: number, overrides = {}) => ({
  val,
  start: '2025-01-01',
  end: '2025-12-31',
  form: '10-K',
  fp: 'FY',
  filed: '2026-02-01',
  accn: '0000000001-26-000001',
  ...overrides,
});
function normalize(issuance: unknown[], repayment: unknown[] = []) {
  return normalizeCompanyFacts({
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: [observation(100)] } },
        ProceedsFromIssuanceOfDebt: {
          units: { USD: issuance, EUR: [observation(999)] },
        },
        RepaymentsOfDebt: { units: { USD: repayment } },
        ProceedsFromIssuanceOfLongTermDebt: {
          units: { USD: [observation(200)] },
        },
        ProceedsFromShortTermDebt: { units: { USD: [observation(300)] } },
        RepaymentsOfLongTermDebtAndCapitalSecurities: {
          units: { USD: [observation(400)] },
        },
        LongTermDebtNoncurrent: {
          units: { USD: [observation(500, { start: undefined })] },
        },
      },
    },
  });
}
const allocation = (row: ReturnType<typeof normalize>['annual'][number]) =>
  annualCapitalAllocation(
    row,
    JSON.parse(JSON.stringify(row.sources)),
    '0000000001',
  ).debtCashFlows!;
it('persists exact annual aggregate USD provenance in JSON, avoids component double counts and preserves true zero', () => {
  const row = normalize([observation(20e6)], [observation(0)]).annual[0];
  const result = allocation(row);
  expect(result.debtIssuance.value).toBe(20e6);
  expect(result.debtRepayments.value).toBe(0);
  expect(result.debtIssuance.sources[0]).toMatchObject({
    concept: 'us-gaap:ProceedsFromIssuanceOfDebt',
    unit: 'USD',
    start: '2025-01-01',
    end: '2025-12-31',
    accessionNumber: '0000000001-26-000001',
    filed: '2026-02-01',
  });
  expect(result.debtRepayments.sources[0].concept).toBe(
    'us-gaap:RepaymentsOfDebt',
  );
});
it('does not substitute components, leases, net flows or missing amounts with zero', () => {
  const result = allocation(normalize([]).annual[0]);
  expect(result.debtIssuance.value).toBeNull();
  expect(result.debtRepayments.value).toBeNull();
  expect(result.debtIssuance.sources).toEqual([]);
});
it.each([
  { start: '2025-10-01', form: '10-Q' },
  { end: '2025-09-30', form: '10-Q' },
  { start: undefined },
  { dimensions: { Segment: 'A' } },
  { val: -1 },
  { filed: '2025-02-01' },
  { accn: 'invalid' },
  { fp: 'Q4' },
  { dimensions: 'invalid' },
  { filed: '2026-02-30' },
])(
  'rejects incompatible periods, contexts and invalid values: %j',
  (override) => {
    expect(
      allocation(normalize([observation(20, override)]).annual[0]).debtIssuance
        .value,
    ).toBeNull();
  },
);
it('uses latest annual restatement only for its actual dates, and leaves conflicting same-filing facts missing', () => {
  const revised = observation(25, {
    filed: '2027-02-01',
    accn: '0000000001-27-000001',
    fy: 2026,
  });
  expect(
    allocation(normalize([observation(20), revised]).annual[0]).debtIssuance
      .value,
  ).toBe(25);
  const conflict = allocation(
    normalize([observation(20), revised, { ...revised, val: 26 }]).annual[0],
  ).debtIssuance;
  expect(conflict.value).toBeNull();
  expect(conflict.reason).toContain('冲突');
});
it('old caches and quarterly rows remain missing without requests or estimated flows', () => {
  const row = normalize([observation(20)]).annual[0];
  expect(
    annualCapitalAllocation(row, {}, '0000000001').debtCashFlows?.debtIssuance
      .value,
  ).toBeNull();
  expect(
    allocation({ ...row, fiscalQuarter: 4 }).debtIssuance.value,
  ).toBeNull();
});
