import {
  emptyCapitalInformation,
  mergeCapitalInformation,
  validateCapitalInformation,
} from '../src/modules/ai-research/capital-information';
import {
  validateSummary,
  TOPICS,
} from '../src/modules/ai-research/summary-schema';
import type { AcquisitionEvent } from '@company-research/shared';

// Verbatim passages from the existing GOOGL Item 7 cache; never fetched by tests.
const source = [
  {
    id: 'Item 7:p136',
    text: 'In 2025, we entered into definitive agreements to acquire Wiz, a leading cloud security platform, for $32.0 billion, and Intersect, a provider of data center and energy infrastructure solutions, for $4.8 billion in cash plus the assumption of debt. Both acquisitions are expected to close in 2026, subject to customary closing conditions, including the receipt of regulatory approvals.',
  },
  {
    id: 'Item 7:p378',
    text: 'In March 2025, we entered into a definitive agreement to acquire Wiz, Inc. ("Wiz"), a leading cloud security platform, for $32.0 billion, subject to closing adjustments, in an all-cash transaction. The acquisition of Wiz is expected to close in 2026, subject to customary closing conditions, including the receipt of regulatory approvals.',
  },
  {
    id: 'Item 7:p379',
    text: 'In December 2025, we entered into a definitive agreement to acquire Intersect, which provides data center and energy infrastructure solutions, for $4.8 billion in cash, plus the assumption of debt. The acquisition of Intersect is expected to close in the first half of 2026, subject to customary closing conditions.',
  },
  {
    id: 'Item 7:p353',
    text: 'As of December 31, 2025, we had $10.0 billion of revolving credit facilities, $4.0 billion expiring in April 2026 and $6.0 billion expiring in April 2030. No amounts have been borrowed under the credit facilities.',
  },
  {
    id: 'Item 7:p338',
    text: 'In 2026, we expect to significantly increase, relative to 2025, our investment in our technical infrastructure, including servers and network equipment, and data centers.',
  },
];
const evidence = (i: number) => [
  { paragraphId: source[i].id, quote: source[i].text },
];
function deal(targetName = 'Wiz', i = 1): AcquisitionEvent {
  return {
    targetName,
    transactionDate: {
      value: i === 2 ? '2025-12' : '2025-03',
      precision: 'month',
      type: 'agreement',
      evidence: evidence(i),
    },
    transactionValue: {
      rawText: i === 2 ? '$4.8 billion' : '$32.0 billion',
      currency: 'USD',
      scope: i === 2 ? 'cashPlusDebt' : 'cash',
      evidence: evidence(i),
    },
    acquisitionPurpose: null,
    transactionStatus: 'pending',
    considerationType: i === 2 ? 'cashPlusDebt' : 'cash',
    evidence: evidence(i),
  };
}
it('keeps Wiz/Intersect separate, deduplicates supported repeated mentions and preserves month precision/null purpose', () => {
  const a = emptyCapitalInformation();
  a.acquisitions.events = [deal(), deal('Intersect', 2)];
  const b = emptyCapitalInformation();
  b.acquisitions.events = [deal()];
  const merged = mergeCapitalInformation([a, b], source);
  expect(merged.acquisitions.events).toHaveLength(2);
  expect(merged.acquisitions.events[0].transactionDate?.value).toBe('2025-03');
  expect(merged.acquisitions.events[0].acquisitionPurpose).toBeNull();
  expect(
    merged.acquisitions.events.every((e) => e.transactionStatus === 'pending'),
  ).toBe(true);
});
it('merges overview and detailed facts only with compatible date/value and explicit official aliases', () => {
  const a = emptyCapitalInformation(),
    b = emptyCapitalInformation();
  const overview = deal('Wiz', 0);
  overview.considerationType = 'unknown';
  overview.transactionValue!.scope = 'unknown';
  overview.transactionDate = {
    value: '2025',
    precision: 'year',
    type: 'agreement',
    evidence: evidence(0),
  };
  a.acquisitions.events = [overview];
  b.acquisitions.events = [deal('Wiz, Inc.')];
  const merged = mergeCapitalInformation([a, b], source);
  expect(merged.acquisitions.events).toHaveLength(1);
  expect(merged.acquisitions.events[0].evidence).toHaveLength(2);
  expect(merged.acquisitions.events[0].transactionDate?.value).toBe('2025-03');
  expect(merged.acquisitions.events[0].considerationType).toBe('cash');
});
it('rejects fabricated days, completed status from pending facts and cash as debt-inclusive total', () => {
  for (const mutate of [
    (e: AcquisitionEvent) => {
      e.transactionDate!.value = '2025-03-01';
      e.transactionDate!.precision = 'day';
    },
    (e: AcquisitionEvent) => {
      e.transactionStatus = 'completed';
    },
    (e: AcquisitionEvent) => {
      e.transactionDate!.type = 'completion';
    },
  ]) {
    const data = emptyCapitalInformation();
    const e = deal();
    mutate(e);
    data.acquisitions.events = [e];
    expect(() => validateCapitalInformation(data, source)).toThrow();
  }
  const data = emptyCapitalInformation();
  data.acquisitions.events = [deal('Intersect', 2)];
  data.acquisitions.events[0].transactionValue!.scope = 'total';
  expect(() => validateCapitalInformation(data, source)).toThrow();
});
it('rejects business descriptions as an acquisition purpose and stock consideration without stock evidence', () => {
  const data = emptyCapitalInformation(),
    e = deal();
  e.acquisitionPurpose = {
    text: '为了经营云安全业务',
    kind: 'fact',
    evidence: evidence(1),
  };
  data.acquisitions.events = [e];
  expect(() => validateCapitalInformation(data, source)).toThrow();
  e.acquisitionPurpose = null;
  e.considerationType = 'cashAndStock';
  expect(() => validateCapitalInformation(data, source)).toThrow();
});
it('separates unused facilities and future plans from actual financing/investment', () => {
  const data = emptyCapitalInformation();
  data.debtAndFinancing.financingActivities = [
    {
      text: '尚未使用的循环授信',
      kind: 'fact',
      activityType: 'creditFacility',
      evidence: evidence(3),
    },
  ];
  data.reinvestment.investmentPlans = [
    { text: '预计增加技术基础设施投资', kind: 'plan', evidence: evidence(4) },
  ];
  expect(
    validateCapitalInformation(data, source).debtAndFinancing
      .financingActivities[0].activityType,
  ).toBe('creditFacility');
  data.debtAndFinancing.financingActivities[0].activityType = 'actualFinancing';
  expect(() => validateCapitalInformation(data, source)).toThrow();
  data.debtAndFinancing.financingActivities = [];
  data.reinvestment.investmentPlans[0].kind = 'fact';
  expect(() => validateCapitalInformation(data, source)).toThrow();
});
it('rejects quotes outside the actual Item 7 input, distinguishes partial coverage, and accepts empty arrays', () => {
  expect(
    validateCapitalInformation(emptyCapitalInformation(), source).acquisitions
      .events,
  ).toEqual([]);
  const data = emptyCapitalInformation();
  data.acquisitions.events = [deal()];
  expect(() => validateCapitalInformation(data, [source[0]])).toThrow();
  data.acquisitions.events = [];
  data.coverage = 'partial';
  expect(() => validateCapitalInformation(data, source)).toThrow();
  data.coverageReason = '输入表格无法完整还原';
  expect(validateCapitalInformation(data, source).coverage).toBe('partial');
});
it('does not truncate capital events to five or require regeneration to read legacy summaries', () => {
  const data = emptyCapitalInformation();
  data.acquisitions.events = Array.from({ length: 8 }, () => deal());
  expect(
    validateCapitalInformation(data, source).acquisitions.events,
  ).toHaveLength(8);
  const legacy = {
    groups: TOPICS.management.map((topic) => ({ topic, findings: [] })),
  };
  expect(validateSummary(legacy, 'management', source)).toEqual(legacy);
  expect(() => validateSummary(legacy, 'management', source, true)).toThrow();
});
it('does not confuse zero ending debt with the absence of actual issuance and repayment during the year', () => {
  const p = {
    id: 'Item 7:p1',
    text: 'We issued commercial paper during 2025 and repaid it during the year. No commercial paper was outstanding at year end.',
  };
  const data = emptyCapitalInformation();
  data.debtAndFinancing.financingActivities = [
    {
      text: '本年发行并偿还商业票据，期末无余额',
      kind: 'fact',
      activityType: 'actualFinancing',
      evidence: [{ paragraphId: p.id, quote: p.text }],
    },
  ];
  expect(
    validateCapitalInformation(data, [p]).debtAndFinancing
      .financingActivities[0].activityType,
  ).toBe('actualFinancing');
});

it('mock notes deduplicate identical facts while retaining different maturities, purposes and investment types', () => {
  const ps = [
    {
      id: 'Item 7:mock',
      text: 'We issued $2 billion notes due 2030 and $3 billion notes due 2040 for general corporate purposes. R&D expense was $1 billion and capital expenditures were $4 billion.',
    },
  ];
  const evidence = [{ paragraphId: ps[0].id, quote: ps[0].text }];
  const a = emptyCapitalInformation();
  a.debtAndFinancing.financingTerms = [
    { text: '20亿美元票据于2030年到期。', kind: 'fact', evidence },
    { text: '30亿美元票据于2040年到期。', kind: 'fact', evidence },
  ];
  a.debtAndFinancing.financingPurposes = [
    { text: '一般公司用途。', kind: 'fact', evidence },
  ];
  a.reinvestment.investmentAreas = [
    { text: '研发费用10亿美元。', kind: 'fact', evidence },
    { text: '资本支出40亿美元。', kind: 'fact', evidence },
  ];
  const before = JSON.stringify(a);
  const merged = mergeCapitalInformation([a, structuredClone(a)], ps);
  expect(merged.debtAndFinancing.financingTerms).toHaveLength(2);
  expect(merged.debtAndFinancing.financingPurposes).toHaveLength(1);
  expect(merged.reinvestment.investmentAreas).toHaveLength(2);
  expect(merged.debtAndFinancing.financingRisks).toEqual([]);
  expect(JSON.stringify(a)).toBe(before);
});
