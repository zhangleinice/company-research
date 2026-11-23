import { z } from 'zod';
import {
  capitalInformationSchema,
  emptyCapitalInformation,
  validateCapitalInformation,
} from '../src/modules/ai-research/capital-information';
import { hasActualFinancingEvidence } from '../src/modules/ai-research/financing-facts';
import {
  ExtractionValidationError,
  validationDiagnostics,
} from '../src/modules/ai-research/validation-diagnostics';
import { digest } from '../src/modules/ai-research/generation-checkpoint';
// Exact, existing GOOGL FY2025 items-v2 cache passages; tests never download SEC files.
const source = [
  {
    id: 'Item 7:p137',
    text: '•In 2025, we issued senior unsecured notes for net proceeds of $37.3 billion, to be used for general corporate purposes.',
  },
  {
    id: 'Item 7:p328',
    text: 'Net cash used in financing activities decreased from 2024 to 2025 due to an increase in proceeds from issuance of debt and a decrease in repurchases of stock, partially offset by repayments of debt.',
  },
  {
    id: 'Item 7:p353',
    text: 'As of December 31, 2025, we had $10.0 billion of revolving credit facilities, $4.0 billion expiring in April 2026 and $6.0 billion expiring in April 2030. No amounts have been borrowed under the credit facilities. We also have a commercial paper program of up to $25.0 billion, which is used for general corporate purposes. As of December 31, 2025, we had no commercial paper outstanding.',
  },
];
function note(p = source[0]) {
  return {
    kind: 'fact' as const,
    activityType: 'actualFinancing' as const,
    text: '报告期内已发生融资活动。',
    evidence: [{ paragraphId: p.id, quote: p.text }],
  };
}
it.each([source[0], source[1]])(
  'accepts real cached historical issuance and repayment evidence: $id',
  (p) => {
    const data = emptyCapitalInformation();
    data.debtAndFinancing.financingActivities = [note(p)];
    expect(validateCapitalInformation(data, source)).toEqual(data);
  },
);
it.each([
  'Proceeds from issuance of debt increased during 2025.',
  'Repayments of debt increased during 2025.',
  'Issuance of senior unsecured notes totaled $5.0 billion during 2025.',
  'Borrowings under a credit facility totaled $2.0 billion during 2025.',
  'Redemption of outstanding notes was completed in 2025.',
  'We borrowed $2.0 billion under a credit facility during 2025.',
  'We issued commercial paper during 2025 and repaid it during the year. No commercial paper was outstanding at year end.',
  'We issued $5.0 billion of notes and may issue additional debt in 2026.',
  'We received proceeds from loans during 2025.',
])('recognizes completed financing expressions: %s', (text) =>
  expect(hasActualFinancingEvidence([text])).toBe(true),
);
it.each([
  source[2].text,
  'Available credit facility of $10.0 billion.',
  'Borrowings under our credit facility are available up to $10 billion.',
  'An undrawn credit line supports planned borrowings under a credit facility.',
  'Our commercial paper program capacity increased to $25.0 billion during 2025.',
  'We have authorization to issue securities and plan debt issuance in 2026.',
  'Planned debt issuance of senior unsecured notes in 2026.',
  'Proceeds from issuance of debt are expected to increase during 2026.',
  'Repayments of debt scheduled for 2026 total $5.0 billion.',
  'We did not issue debt and no amounts have been borrowed under our credit facilities.',
  'If the transaction closes, proceeds from issuance of debt would fund the acquisition.',
  'We received authorization for issuance of notes.',
  'We received an available credit facility of $10 billion.',
  'Borrowings under the credit facility were $2 billion outstanding as of December 31, 2025.',
  'We had zero borrowings under the credit facility during 2025.',
  'Cash provided by financing activities consists primarily of proceeds from issuance of debt.',
  'Debt, notes and credit facilities are important to our capital structure.',
  'Proceeds from issuance of debt.',
  'Repayments of debt in 2026: $5.0 billion.',
  'Issuance of notes during 2026: $5.0 billion.',
  'We received a letter about debt financing.',
])(
  'does not promote capacity, plans, balances, generic descriptions or ambiguity: %s',
  (text) => expect(hasActualFinancingEvidence([text])).toBe(false),
);
it('keeps credit facilities/programs/plans representable without relabeling them actual financing', () => {
  for (const activityType of [
    'creditFacility',
    'commercialPaperProgram',
    'plan',
    'other',
  ] as const) {
    const data = emptyCapitalInformation();
    data.debtAndFinancing.financingActivities = [
      {
        ...note(source[2]),
        activityType,
        kind: activityType === 'plan' ? 'plan' : 'fact',
      },
    ];
    expect(validateCapitalInformation(data, source)).toEqual(data);
  }
});
it('locates the exact invalid financing record and keeps verbatim evidence enforcement', () => {
  const data = emptyCapitalInformation();
  data.debtAndFinancing.financingActivities = [
    note(),
    note(source[1]),
    note(source[2]),
  ];
  try {
    validateCapitalInformation(data, source);
    throw Error('Expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(ExtractionValidationError);
    expect(
      validationDiagnostics(error, data, 'Item 7', 2, 'not-a-real-key'),
    ).toEqual([
      expect.objectContaining({
        item: 'Item 7',
        chunk: 2,
        phase: 'chunk',
        fieldPath: 'capitalAllocation.debtAndFinancing.financingActivities[2]',
        errorType: 'FINANCING_ACTUAL_EVIDENCE_INSUFFICIENT',
        paragraphIds: ['Item 7:p353'],
      }),
    ]);
  }
  data.debtAndFinancing.financingActivities = [note()];
  data.debtAndFinancing.financingActivities[0].evidence[0].quote =
    'Invented quote about issuance of debt in 2025.';
  try {
    validateCapitalInformation(data, source);
  } catch (error) {
    expect(
      validationDiagnostics(error, data, 'Item 7', 1, 'x')[0],
    ).toMatchObject({
      fieldPath:
        'capitalAllocation.debtAndFinancing.financingActivities[0].evidence[0]',
      errorType: 'SEC_EVIDENCE_MISMATCH',
      paragraphIds: ['Item 7:p137'],
    });
  }
  expect(() =>
    validateCapitalInformation(data, [{ ...source[0], id: 'Item 1A:p137' }]),
  ).toThrow('逐字匹配');
});
it('keeps business schema contract unchanged', () => {
  expect(digest(z.toJSONSchema(capitalInformationSchema))).toBe(
    'ea2b57970019146adc31d899be4727efbae488ebeaf7637d9b7dccb0858f76b8',
  );
});
it('bounds and redacts diagnostics without persisting quotes or complete responses', () => {
  const secret = 'private-router-key';
  const error = new ExtractionValidationError(
    'capitalAllocation.debtAndFinancing.financingActivities[0]',
    'TEST',
    ['Item 7:p137'],
    secret + ' sk-abcdef ' + 'x'.repeat(1000),
  );
  const diagnostics = validationDiagnostics(
    error,
    { secret, quote: 'Full raw response must not be saved' },
    'Item 7',
    2,
    secret,
  );
  const text = JSON.stringify(diagnostics);
  expect(text).not.toContain(secret);
  expect(text).not.toContain('sk-abcdef');
  expect(text).not.toContain('Full raw response');
  expect(diagnostics[0].reason.length).toBeLessThanOrEqual(300);
  const invalid = { groups: [], capitalAllocation: emptyCapitalInformation() };
  invalid.capitalAllocation.debtAndFinancing.financingActivities = [
    { ...note(), activityType: 'unrecognized' as never },
  ];
  const parsed = z
    .object({ capitalAllocation: capitalInformationSchema })
    .safeParse(invalid);
  expect(parsed.success).toBe(false);
  if (!parsed.success)
    expect(
      validationDiagnostics(parsed.error, invalid, 'Item 7', 2, secret)[0],
    ).toMatchObject({
      fieldPath:
        'capitalAllocation.debtAndFinancing.financingActivities[0].activityType',
      errorType: 'SCHEMA_VALIDATION',
      paragraphIds: ['Item 7:p137'],
    });
});
