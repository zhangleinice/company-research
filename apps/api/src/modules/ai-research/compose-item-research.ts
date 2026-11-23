import type { AiSummary } from '@prisma/client';
import type { AiResearchSummary } from '@company-research/shared';
import { TOPICS } from './summary-schema';
type Content = AiResearchSummary['summaryJson'];
const aliases = [
  ['经营表现及原因'],
  ['资本开支', '现金流与融资'],
  ['未来经营重点'],
  ['主要风险'],
];
/** Read-only view: independent caches remain independently published and traceable. */
export function composeManagement(
  mda: AiSummary | null,
  risks: AiSummary | null,
  legacy: AiSummary | null,
) {
  if (!mda && !risks) {
    if (!legacy) return null;
    const content = legacy.summaryJson as unknown as Content;
    return {
      ...legacy,
      summaryJson: {
        ...content,
        itemSources: (['Item 7', 'Item 1A'] as const).map((item) => ({
          item,
          accessionNumber: legacy.accessionNumber,
          sourceUrl: legacy.sourceUrl,
          fiscalYear: legacy.fiscalYear,
          filingDate: legacy.filingDate,
          generatedAt: legacy.updatedAt.toISOString(),
          promptVersion: legacy.promptVersion,
          legacy: true,
        })),
      } as unknown as AiSummary['summaryJson'],
    };
  }
  const base = [mda, risks]
    .filter((r): r is AiSummary => Boolean(r))
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0];
  const legacyContent = legacy?.summaryJson as unknown as Content | undefined;
  const mdaContent = mda?.summaryJson as unknown as Content | undefined;
  const riskContent = risks?.summaryJson as unknown as Content | undefined;
  const groups = TOPICS.management.map((topic, i) => {
    const current = (i === 3 ? riskContent : mdaContent)?.groups.find(
      (g) => g.topic === topic,
    );
    if (current) return current;
    const exact = legacyContent?.groups.find((g) => g.topic === topic);
    return (
      exact ?? {
        topic,
        findings: aliases[i].flatMap(
          (name) =>
            legacyContent?.groups.find((g) => g.topic === name)?.findings ?? [],
        ),
      }
    );
  });
  const sources: NonNullable<Content['itemSources']> = [];
  for (const [item, row, old] of [
    ['Item 7', mda ?? legacy, !mda],
    ['Item 1A', risks ?? legacy, !risks],
  ] as const) {
    if (row)
      sources.push({
        item,
        accessionNumber: row.accessionNumber,
        sourceUrl: row.sourceUrl,
        fiscalYear: row.fiscalYear,
        filingDate: row.filingDate,
        generatedAt: row.updatedAt.toISOString(),
        promptVersion: row.promptVersion,
        legacy: old,
      });
  }
  const summaryJson: Content = {
    groups,
    itemSources: sources,
    unavailableItems: [
      ...(!mda && !legacy ? ['Item 7' as const] : []),
      ...(!risks && !legacy ? ['Item 1A' as const] : []),
    ],
    ...((mdaContent ?? legacyContent)?.capitalAllocation
      ? { capitalAllocation: (mdaContent ?? legacyContent)!.capitalAllocation }
      : {}),
  };
  return {
    ...base,
    section: 'management',
    promptVersion: 'item-composition-v1',
    summaryJson: summaryJson as unknown as AiSummary['summaryJson'],
  };
}
