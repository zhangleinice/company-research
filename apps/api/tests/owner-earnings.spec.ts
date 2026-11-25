import { annualOwnerEarningsInputs } from '../src/modules/financials/owner-earnings-inputs';
import {
  calculateOwnerEarnings,
  ownerDraftSchema,
  ownerEarningsHistory,
  ownerResponse,
} from '../src/modules/valuation/owner-earnings';
import {
  OWNER_EARNINGS_POLICY,
  type OwnerEarningsDraft,
  type OwnerEarningsEstimate,
} from '@company-research/shared';
import { OwnerEarningsService } from '../src/modules/valuation/owner-earnings.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const cik = '0000000001';
const start = '2025-01-01',
  end = '2025-12-31',
  accn = '0000000001-26-000001';
const item = (tag: string, val: number) => ({
  concept: `us-gaap:${tag}`,
  val,
  unit: 'USD',
  start,
  end,
  accn,
  filed: '2026-02-01',
  form: '10-K',
});
function sample() {
  const r = {
    fiscalYear: 2025,
    fiscalQuarter: null,
    periodStart: start,
    periodEnd: end,
    currency: 'USD',
    netIncome: 40,
    operatingCashFlow: 100,
    capex: 60,
    fcf: 40,
    revenue: 200,
    sources: {
      netIncome: { items: [item('NetIncomeLoss', 40)] },
      operatingCashFlow: {
        items: [item('NetCashProvidedByUsedInOperatingActivities', 100)],
      },
      capex: {
        items: [item('PaymentsToAcquirePropertyPlantAndEquipment', 60)],
      },
      revenue: { items: [item('Revenues', 200)] },
      ownerEarningsInputs: {} as unknown,
    },
  };
  const raw = {
    cik: 1,
    facts: {
      'us-gaap': Object.fromEntries(
        [
          ['DepreciationDepletionAndAmortization', 20],
          ['ShareBasedCompensation', 10],
        ].map(([tag, val]) => [
          tag,
          { units: { USD: [item(String(tag), Number(val))] } },
        ]),
      ),
    },
  };
  r.sources.ownerEarningsInputs = annualOwnerEarningsInputs(raw, cik, r);
  return { r, raw };
}
const year = () => ownerEarningsHistory(cik, [sample().r])[0];
const draft = (
  patch: Partial<OwnerEarningsDraft> = {},
): OwnerEarningsDraft => ({
  periodStart: start,
  periodEnd: end,
  dataVersion: year().dataVersion,
  method: 'ratio',
  ratio: 50,
  amount: null,
  comparable: true,
  rationale: 'isolated test only',
  ...patch,
});

it('read-only previews reuse the engine, normalize ratio scope, and never declare the draft saved', async () => {
  const service = new OwnerEarningsService({} as PrismaService);
  const data = ownerResponse(cik, 'TEST', [year()], null);
  jest.spyOn(service, 'read').mockResolvedValue(data);
  const preview = await service.preview(cik, draft({ comparable: false }));
  expect(preview.results).toMatchObject({
    maintenanceCapex: 30,
    growthCapex: 30,
    ownerEarnings: 70,
    sbcAdjustedOwnerEarnings: 60,
  });
  expect(preview.data.estimateStatus).toBe('none');
  expect(preview.data.results.ownerEarnings).toBeNull();
  expect(
    (
      await service.preview(
        cik,
        draft({
          method: 'amount',
          ratio: null,
          amount: 0.00004,
          comparable: false,
        }),
      )
    ).results,
  ).toMatchObject({
    maintenanceCapex: 40,
    growthCapex: null,
    ownerEarnings: 60,
  });
  expect(
    (await service.preview(cik, draft({ ratio: 0 }))).results.maintenanceCapex,
  ).toBe(0);
  await expect(
    service.preview(cik, draft({ ratio: -1 })),
  ).rejects.toMatchObject({ status: 400 });
});
it('preview uses new cached inputs without saving a new fingerprint or carrying a draft into another fiscal period', async () => {
  const service = new OwnerEarningsService({} as PrismaService);
  const y = year();
  y.sbc.value = null;
  jest
    .spyOn(service, 'read')
    .mockResolvedValue(ownerResponse(cik, 'TEST', [y], null));
  expect(
    (await service.preview(cik, draft({ dataVersion: 'b'.repeat(64) })))
      .results,
  ).toMatchObject({ ownerEarnings: 70, sbcAdjustedOwnerEarnings: null });
  expect(
    (await service.preview(cik, draft({ periodEnd: '2024-12-31' }))).results
      .maintenanceCapex,
  ).toBeNull();
  y.operatingCashFlow.value = null;
  expect(
    (await service.preview(cik, draft())).results.ownerEarnings,
  ).toBeNull();
  expect(
    (await service.preview(cik, draft({ ratio: 50 }))).results.maintenanceCapex,
  ).toBe(30);
});
it('reads only complete annual facts with provenance and calculates capital intensity', () => {
  const y = year();
  expect(y.depreciationAmortization.value).toBe(20);
  expect(y.sbc.value).toBe(10);
  expect(y.capexToRevenue).toBe(30);
  expect(y.daToRevenue).toBe(10);
  expect(y.netIncomeScope).toBe('parent');
  expect(y.sbc.sources[0].url).toContain('000000000126000001');
});
it('uses 50% ratio without D&A or a second working-capital adjustment', () => {
  expect(calculateOwnerEarnings(year(), draft(), true)).toMatchObject({
    maintenanceCapex: 30,
    growthCapex: 30,
    ownerEarnings: 70,
    sbcAdjustedOwnerEarnings: 60,
  });
});
it('allows explicit zero, negative earnings, and amounts above actual CapEx without inventing growth', () => {
  expect(
    calculateOwnerEarnings(year(), draft({ ratio: 0 }), true).maintenanceCapex,
  ).toBe(0);
  const amount = draft({ method: 'amount', ratio: null, amount: 0.00012 });
  expect(calculateOwnerEarnings(year(), amount, true)).toMatchObject({
    maintenanceCapex: 120,
    growthCapex: null,
    ownerEarnings: -20,
    sbcAdjustedOwnerEarnings: -30,
  });
  expect(
    calculateOwnerEarnings(
      year(),
      draft({ method: 'amount', ratio: null, amount: 0, comparable: false }),
      true,
    ),
  ).toMatchObject({
    maintenanceCapex: 0,
    growthCapex: null,
    ownerEarnings: 100,
  });
});
it.each([false, true])(
  'unconfirmed, missing, or mismatched assumptions stay null (%s)',
  (confirmed) => {
    expect(
      calculateOwnerEarnings(year(), null, confirmed).ownerEarnings,
    ).toBeNull();
    expect(
      calculateOwnerEarnings(
        year(),
        draft({ periodStart: '2024-01-01' }),
        confirmed,
      ).ownerEarnings,
    ).toBeNull();
    expect(
      calculateOwnerEarnings(
        year(),
        draft({ dataVersion: 'a'.repeat(64) }),
        confirmed,
      ).ownerEarnings,
    ).toBeNull();
    if (!confirmed)
      expect(
        calculateOwnerEarnings(year(), draft(), false).ownerEarnings,
      ).toBeNull();
  },
);
it('missing SBC affects only adjusted earnings; missing OCF affects both; missing CapEx allows amount estimates', () => {
  const y = year();
  y.sbc.value = null;
  expect(calculateOwnerEarnings(y, draft(), true)).toMatchObject({
    ownerEarnings: 70,
    sbcAdjustedOwnerEarnings: null,
  });
  y.operatingCashFlow.value = null;
  expect(calculateOwnerEarnings(y, draft(), true).ownerEarnings).toBeNull();
  y.operatingCashFlow.value = 0;
  y.capex.value = null;
  expect(calculateOwnerEarnings(y, draft(), true).maintenanceCapex).toBeNull();
  expect(
    calculateOwnerEarnings(
      y,
      draft({ method: 'amount', ratio: null, amount: 0 }),
      true,
    ).ownerEarnings,
  ).toBe(0);
});
it('does not accept depreciation, a custom combined line, quarterly/YTD, another filing, or conflicting facts', () => {
  const { r, raw } = sample();
  const f = raw.facts['us-gaap'];
  delete f.DepreciationDepletionAndAmortization;
  f.Depreciation = { units: { USD: [item('Depreciation', 20)] } };
  f.DepreciationAmortizationAndOther = {
    units: { USD: [item('DepreciationAmortizationAndOther', 25)] },
  };
  expect(
    annualOwnerEarningsInputs(raw, cik, r).depreciationAmortization.value,
  ).toBeNull();
  f.ShareBasedCompensation.units.USD[0].accn = '0000000001-25-000001';
  expect(annualOwnerEarningsInputs(raw, cik, r).sbc.value).toBeNull();
  f.ShareBasedCompensation.units.USD = [
    item('ShareBasedCompensation', 10),
    item('ShareBasedCompensation', 11),
  ];
  expect(annualOwnerEarningsInputs(raw, cik, r).sbc.value).toBeNull();
  expect(annualOwnerEarningsInputs(raw, '0000000002', r).sbc.value).toBeNull();
  expect(
    ownerEarningsHistory(cik, [
      { ...r, periodStart: '2025-10-01', fiscalQuarter: 4 },
    ]),
  ).toEqual([]);
});
it('enforces current supplemental version and scope; preserves missing versus actual zero', () => {
  const { r } = sample();
  r.sources.ownerEarningsInputs = { version: 0 };
  expect(ownerEarningsHistory(cik, [r])[0].sbc.value).toBeNull();
  const z = sample();
  z.r.operatingCashFlow = 0;
  z.r.sources.operatingCashFlow.items[0].val = 0;
  z.r.fcf = -60;
  expect(ownerEarningsHistory(cik, [z.r])[0].operatingCashFlow.value).toBe(0);
  const bad = sample();
  bad.r.sources.capex.items[0].start = '2025-02-01';
  expect(ownerEarningsHistory(cik, [bad.r])[0].fcf.value).toBeNull();
});
it.each([0, -1])('does not divide by nonpositive revenue %s', (n) => {
  const { r } = sample();
  r.revenue = n;
  r.sources.revenue.items[0].val = n;
  expect(ownerEarningsHistory(cik, [r])[0].capexToRevenue).toBeNull();
});
it('binds company, year, baseline revision and policy; refresh does not silently reuse a saved assumption', () => {
  const y = year();
  const estimate: OwnerEarningsEstimate = {
    ...draft(),
    cik,
    fiscalYear: 2025,
    capexBasis: 60,
    policyVersion: OWNER_EARNINGS_POLICY,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  expect(ownerResponse(cik, 'TEST', [y], estimate).estimateStatus).toBe(
    'confirmed',
  );
  expect(
    ownerResponse('0000000002', 'OTHER', [y], estimate).estimateStatus,
  ).toBe('needs_reconfirmation');
  expect(
    ownerResponse(cik, 'TEST', [{ ...y, periodEnd: '2026-12-31' }], estimate)
      .results.ownerEarnings,
  ).toBeNull();
  expect(
    ownerResponse(cik, 'TEST', [y], { ...estimate, policyVersion: 'old' })
      .estimateStatus,
  ).toBe('needs_reconfirmation');
  const { r } = sample();
  r.operatingCashFlow = 101;
  r.sources.operatingCashFlow.items[0].val = 101;
  r.fcf = 41;
  expect(
    ownerResponse(cik, 'TEST', ownerEarningsHistory(cik, [r]), estimate)
      .estimateStatus,
  ).toBe('needs_reconfirmation');
});
it('rejects invalid inputs and preserves precision', () => {
  for (const p of [
    { ratio: -1 },
    { ratio: 101 },
    { ratio: null },
    { method: 'amount', ratio: null, amount: -1 },
    { comparable: false },
  ])
    expect(
      ownerDraftSchema.safeParse(draft(p as Partial<OwnerEarningsDraft>))
        .success,
    ).toBe(false);
  expect(
    calculateOwnerEarnings(year(), draft({ ratio: 33.333333333 }), true)
      .maintenanceCapex,
  ).toBe((60 * 33.333333333) / 100);
});
