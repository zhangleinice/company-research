import type {
  AiResearchSummary,
  CapitalNote,
  SecEvidence,
} from '@company-research/shared';
import { ExtractionValidationError } from './validation-diagnostics';
type Content = AiResearchSummary['summaryJson'];
export interface Item7QualityIssue {
  severity: 'error' | 'review';
  code: string;
  fieldPath: string;
  paragraphIds: string[];
  reason: string;
}
const internalLanguage =
  /(?:本块(?!链)|该\s*chunk\b|当前\s*chunk\b|净\s*proceeds\b)/iu;
const liquidityAssurance =
  /\b(?:sufficient|adequate)\b[^.!?]{0,160}\b(?:fund|meet|cover|support)\b/i;
const adverseFinancing =
  /\b(?:unable|not able|insufficient|inadequate|shortfall|default|breach)\b|\b(?:refinancing|interest rate|liquidity)\s+risk\b/i;
const distributionFact =
  /\b(?:repurchas(?:e[ds]?|ing)|cash dividends?|quarterly dividends?|capital return to stockholders)\b/i;
// Explicit purpose or covenant links, not mere co-occurrence in the same paragraph.
const financingLink =
  /(?:\b(?:proceeds|borrowings|funds raised)\b[^.!?]{0,120}\b(?:used|use|fund|finance)\b[^.!?]{0,120}\b(?:repurchases?|dividends?)\b|\b(?:repurchases?|dividends?)\b[^.!?]{0,60}\b(?:funded|financed)\s+(?:by|with|through)\s+(?:debt|borrowings|proceeds)\b|\b(?:covenants?|debt agreement|credit agreement|loan agreement)\b[^.!?]{0,100}\b(?:restrict|limit|prohibit)\w*\b[^.!?]{0,100}\b(?:dividends?|repurchases?)\b)/i;
/** Advisory semantic findings never filter, rewrite, or certify financial facts. */
export function reviewItem7Quality(content: Content): Item7QualityIssue[] {
  const issues: Item7QualityIssue[] = [];
  const add = (
    severity: Item7QualityIssue['severity'],
    code: string,
    fieldPath: string,
    evidence: SecEvidence[],
    reason: string,
  ) =>
    issues.push({
      severity,
      code,
      fieldPath,
      paragraphIds: [...new Set(evidence.map((e) => e.paragraphId))],
      reason,
    });
  const language = (text: string, path: string, evidence: SecEvidence[]) => {
    if (internalLanguage.test(text))
      add(
        'error',
        'MDA_NARRATIVE_LANGUAGE',
        path,
        evidence,
        '中文正文不得包含本块、该Chunk、当前Chunk或净 proceeds；请使用自然中文，英文SEC引文保持原样',
      );
  };
  content.groups.forEach((g, i) =>
    g.findings.forEach((f, j) =>
      language(f.text, `groups[${i}].findings[${j}].text`, f.evidence),
    ),
  );
  const capital = content.capitalAllocation;
  if (!capital) return issues;
  for (const [section, groups] of Object.entries({
    reinvestment: capital.reinvestment,
    debtAndFinancing: capital.debtAndFinancing,
  }))
    for (const [key, notes] of Object.entries(groups))
      for (const [i, n] of (notes as CapitalNote[]).entries())
        language(
          n.text,
          `capitalAllocation.${section}.${key}[${i}].text`,
          n.evidence,
        );
  capital.acquisitions.events.forEach((e, i) => {
    if (e.acquisitionPurpose)
      language(
        e.acquisitionPurpose.text,
        `capitalAllocation.acquisitions.events[${i}].acquisitionPurpose.text`,
        e.acquisitionPurpose.evidence,
      );
  });
  for (const [i, n] of capital.debtAndFinancing.financingRisks.entries()) {
    if (
      n.evidence.some((e) => liquidityAssurance.test(e.quote)) &&
      !n.evidence.some((e) => adverseFinancing.test(e.quote))
    )
      add(
        'review',
        'LIQUIDITY_ASSESSMENT_NOT_EXPLICIT_RISK',
        `capitalAllocation.debtAndFinancing.financingRisks[${i}]`,
        n.evidence,
        '引用包含流动性充足判断，未识别明确不利融资陈述；应人工核实，不得反向推断风险',
      );
  }
  for (const [key, notes] of Object.entries(capital.debtAndFinancing))
    for (const [i, n] of notes.entries()) {
      if (
        /股息|分红|派息|回购/u.test(n.text) &&
        n.evidence.some((e) => distributionFact.test(e.quote)) &&
        !n.evidence.some((e) => financingLink.test(e.quote))
      )
        add(
          'review',
          'POSSIBLE_CAPITAL_RETURN_DUPLICATION',
          `capitalAllocation.debtAndFinancing.${key}[${i}]`,
          n.evidence,
          '可能重复股息或回购Section，未识别直接融资用途或债务条款关联；人工复核，不能自动删减',
        );
      if (
        (n.activityType === 'plan' || n.kind === 'plan') &&
        /预计|计划|拟/u.test(n.text) &&
        /年末|期末|现有|已确认|账面|余额|未折现/u.test(n.text) &&
        n.evidence.some((e) =>
          /\b(?:expect|plan|intend)\w*\b[^.!?]{0,100}\b(?:finance leases?|financing|debt)\b/i.test(
            e.quote,
          ),
        ) &&
        n.evidence.some((e) =>
          /\b(?:carrying value|outstanding|total undiscounted future lease payments)\b/i.test(
            e.quote,
          ),
        )
      )
        add(
          'review',
          'MIXED_FINANCING_TIME_STATES',
          `capitalAllocation.debtAndFinancing.${key}[${i}]`,
          n.evidence,
          '同一条目可能混合未来计划与现有余额／已签承诺，应拆分时间状态；不自动改写',
        );
    }
  return issues;
}
/** Only unambiguous narrative artifacts block NEW generation, never passive legacy cache reads. */
export function validateNewItem7Quality(content: Content): Item7QualityIssue[] {
  const issues = reviewItem7Quality(content);
  const blocking = issues.find((i) => i.severity === 'error');
  if (blocking)
    throw new ExtractionValidationError(
      blocking.fieldPath,
      blocking.code,
      blocking.paragraphIds,
      blocking.reason,
    );
  return issues;
}
