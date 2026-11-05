import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { CompanyFinancials } from '@company-research/shared';
import type { FactSource } from './annual-financials';

export interface SnapshotRow extends CompanyFinancials {
  cik: string;
  sources: Partial<
    Record<
      | 'revenue'
      | 'previousRevenue'
      | 'netIncome'
      | 'operatingCashFlow'
      | 'capitalExpenditure',
      FactSource
    >
  >;
}
export interface FinancialSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  source: 'SEC';
  companies: SnapshotRow[];
}
export function dataDirectory(configured?: string): string {
  return resolve(__dirname, '../../..', configured || 'data');
}
export async function publishSnapshot(
  directory: string,
  snapshot: FinancialSnapshot,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporary = join(
    directory,
    `financials.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, JSON.stringify(snapshot), { flag: 'wx' });
    // Same filesystem rename: readers see either the previous complete snapshot or the new one.
    await rename(temporary, join(directory, 'financials.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}
