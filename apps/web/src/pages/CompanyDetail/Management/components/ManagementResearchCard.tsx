import type { ComponentProps } from 'react';
import { ResearchCard } from '../../components/ResearchCard.js';
import { ManagementSummary } from './ManagementSummary.js';
export function ManagementResearchCard(
  props: Omit<ComponentProps<typeof ResearchCard>, 'kind' | 'renderSummary'>,
) {
  return (
    <ResearchCard
      {...props}
      kind="management"
      renderSummary={(summary) => (
        <ManagementSummary summary={summary.summaryJson} />
      )}
    />
  );
}
