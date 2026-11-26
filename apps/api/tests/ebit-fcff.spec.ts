import {
  estimateEbitFcff,
  approximateSimpleFcff,
  fcffBridgeNotice,
  type SimpleFcffPeriod,
  type OperatingWorkingCapital,
} from '@company-research/shared';
const f = (n: number, concept: string) => ({
  value: n * 1e6,
  start: '2025-01-01',
  end: '2025-12-31',
  concept: `us-gaap:${concept}`,
  items: [
    {
      start: '2025-01-01',
      end: '2025-12-31',
      concept: `us-gaap:${concept}`,
      unit: 'USD',
      val: n * 1e6,
      accn: '0000000001-26-000001',
    },
  ],
});
function period(): SimpleFcffPeriod {
  const nwc: OperatingWorkingCapital = {
    policyVersion: 'cashflow-operating-nwc-v1',
    cik: '0000000001',
    unit: 'USD',
    periodKind: 'ANNUAL',
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    status: 'PARTIAL',
    identifiedCashImpact: -8e6,
    operatingCash: {
      ratio: 0.02,
      revenue: f(1000, 'Revenues'),
      priorRevenue: f(900, 'Revenues'),
      increment: 2e6,
      formula: '(1000−900)×2%',
      reason: null,
    },
    completeValue: null,
    approximateValue: null,
    partialValue: 10e6,
    defaultValue: null,
    requiresUserAdjustment: true,
    items: [
      {
        category: 'receivables',
        label: '应收',
        status: 'INCLUDED',
        cashImpact: -8e6,
        reason: '经营现金',
        missingLegs: [],
        sources: [{ unit: 'USD' }],
      },
      {
        category: 'otherAssets',
        label: '其他资产',
        status: 'UNRESOLVED',
        cashImpact: -20e6,
        reason: '混合项',
        missingLegs: [],
        sources: [{ unit: 'USD' }],
      },
    ],
    warnings: ['部分参考，不是完整ΔNWC'],
    calculation: '8+2=10',
  };
  return {
    label: 'FY2025',
    start: '2025-01-01',
    end: '2025-12-31',
    ocf: f(200, 'NetCashProvidedByUsedInOperatingActivities'),
    capex: f(50, 'PaymentsToAcquirePropertyPlantAndEquipment'),
    interest: f(10, 'InterestExpense'),
    revenue: f(1000, 'Revenues'),
    tax: f(25, 'IncomeTaxExpenseBenefit'),
    pretax: f(100, 'Pretax'),
    taxSourceValid: true,
    approximationAllowed: true,
    reason: null,
    warnings: [],
    ebitInputs: {
      version: 1,
      cik: '0000000001',
      applicable: true,
      operatingIncome: f(200, 'OperatingIncomeLoss'),
      depreciationAmortization: f(20, 'DepreciationDepletionAndAmortization'),
      workingCapital: nwc,
      cacheIssues: [],
    },
  };
}
test('EBIT uses Operating Income, selected NWC once and does not add interest; OCF policy is unchanged', () => {
  const p = period(),
    r = estimateEbitFcff(p, 0.21);
  expect(r.value).toBe(118);
  expect(r.components.nopat).toBe(158);
  expect(r.nwcBasis).toBe('PARTIAL');
  expect(r.warnings.join()).toContain('部分ΔNWC');
  expect(r.warnings.join()).toContain('其他资产');
  p.interest.value = 999999e6;
  expect(estimateEbitFcff(p, 0.21).value).toBe(118);
  p.interest.value = 10e6;
  expect(approximateSimpleFcff(p, 0.21).value).toBe(157.9);
});
test('complete then approved approximate NWC take precedence; partial and manual remain research assumptions', () => {
  const p = period(),
    n = p.ebitInputs!.workingCapital!;
  n.status = 'COMPLETE';
  n.completeValue = 8e6;
  expect(estimateEbitFcff(p, 0.21).value).toBe(120);
  n.status = 'APPROXIMATE';
  n.approximateValue = 9e6;
  expect(estimateEbitFcff(p, 0.21).value).toBe(119);
  const r = estimateEbitFcff(p, 0.21, { deltaNwc: -10, da: 0 });
  expect(r.value).toBe(118);
  expect(r.nwcBasis).toBe('MANUAL');
  expect(r.manualComponents).toEqual(['da', 'deltaNwc']);
});
test('missing fields never fallback to OCF or zero; manual inputs can restore a legacy research calculation', () => {
  const p = period();
  p.ebitInputs!.depreciationAmortization.value = null;
  expect(estimateEbitFcff(p, 0.21).value).toBeNull();
  expect(estimateEbitFcff(p, 0.21, { da: 20 }).value).toBe(118);
  p.ebitInputs!.workingCapital = null;
  expect(estimateEbitFcff(p, 0.21, { da: 20 }).value).toBeNull();
  delete p.ebitInputs;
  expect(estimateEbitFcff(p, 0.21).warnings.join()).toContain('旧缓存');
  expect(
    estimateEbitFcff(p, 0.21, { ebit: 200, da: 20, deltaNwc: 10 }).value,
  ).toBe(118);
  expect(
    estimateEbitFcff(p, 0.21, { ebit: 200, da: null, deltaNwc: 10 }).value,
  ).toBeNull();
});
test('rejects improper sources, foreign periods, invalid tax/CapEx/D&A but retains negative FCFF', () => {
  const p = period();
  expect(estimateEbitFcff(p, 0.21, { ebit: -200 }).value).toBe(-198);
  expect(estimateEbitFcff(p, -0.1).value).toBeNull();
  expect(estimateEbitFcff(p, 0.21, { da: -1 }).value).toBeNull();
  expect(estimateEbitFcff(p, 0.21, { capex: -1 }).value).toBeNull();
  p.ebitInputs!.workingCapital!.cik = 'other';
  expect(estimateEbitFcff(p, 0.21).value).toBeNull();
  p.ebitInputs!.operatingIncome.concept =
    'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes';
  expect(estimateEbitFcff(p, 0.21, { deltaNwc: 10 }).value).toBeNull();
  p.ebitInputs!.applicable = false;
  expect(
    estimateEbitFcff(p, 0.21, { ebit: 200, deltaNwc: 10 }).value,
  ).toBeNull();
});
test('dynamic bridge notice preserves OCF caveat and does not claim EBIT solves remaining economic scope', () => {
  expect(fcffBridgeNotice('ocf', false, false)).toContain('非经营性收益调整');
  const text = fcffBridgeNotice('ebit', false, true);
  expect(text).toContain('部分估计');
  expect(text).toContain('特殊索偿');
  expect(text).toContain('SBC');
  expect(fcffBridgeNotice('ebit', true, false)).toContain('手动FCFF');
});
