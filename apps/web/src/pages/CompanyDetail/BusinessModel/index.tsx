import type { ComponentProps } from 'react';
import { ResearchCard as CachedResearchCard } from '../components/ResearchCard.js';
import { BusinessSummary } from './components/BusinessSummary.js';
export function ResearchCard(
  props: Omit<ComponentProps<typeof CachedResearchCard>, 'renderSummary'>,
) {
  return (
    <CachedResearchCard
      {...props}
      renderSummary={(summary) => (
        <BusinessSummary
          summary={summary.summaryJson}
          promptVersion={summary.promptVersion}
        />
      )}
    />
  );
}
