import type { RevenueGroup } from '@company-research/shared';
import type { FilingMetadata } from '../../ai-research/filing-parser';
export function extractTables(html: string, metadata: FilingMetadata & { cik: string }): { groups: RevenueGroup[]; skips: unknown[]; rejected: unknown[] };
