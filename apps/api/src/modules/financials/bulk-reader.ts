import { setImmediate } from 'node:timers/promises';
import { open } from 'yauzl';
import { isObject, summarizeAnnualFacts } from './annual-financials';
import type { FinancialSnapshot, SnapshotRow } from './snapshot';

export interface TickerEntry {
  ticker: string;
  cik: string;
}
export function parseTickers(raw: unknown): TickerEntry[] {
  if (!isObject(raw) || !Object.keys(raw).length)
    throw new Error('Invalid SEC ticker mapping');
  const seen = new Set<string>();
  return Object.values(raw).map((item) => {
    if (
      !isObject(item) ||
      typeof item.ticker !== 'string' ||
      !/^[A-Z0-9][A-Z0-9.-]*$/i.test(item.ticker) ||
      !/^\d{1,10}$/.test(String(item.cik_str)) ||
      Number(item.cik_str) === 0
    )
      throw new Error('Invalid SEC ticker entry');
    const ticker = item.ticker.toUpperCase();
    if (seen.has(ticker)) throw new Error(`Duplicate ticker: ${ticker}`);
    seen.add(ticker);
    return { ticker, cik: String(item.cik_str).padStart(10, '0') };
  });
}

/** Lazy ZIP entries: at most one company JSON is decompressed at a time, never extract paths. */
export async function buildSnapshot(
  zipPath: string,
  tickers: TickerEntry[],
  progress: (count: number) => void = () => undefined,
): Promise<FinancialSnapshot> {
  const wanted = new Set(tickers.map((item) => item.cik));
  const summaries = new Map<string, ReturnType<typeof summarizeAnnualFacts>>();
  await new Promise<void>((resolve, reject) => {
    open(
      zipPath,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error('Unable to open SEC archive'));
          return;
        }
        let failed = false;
        const fail = (error: unknown) => {
          if (!failed) {
            failed = true;
            zip.close();
            reject(error);
          }
        };
        zip.on('error', fail);
        zip.on('end', () => resolve());
        zip.on('entry', (entry) => {
          const match = /(?:^|\/)CIK(\d{10})\.json$/i.exec(entry.fileName);
          if (!match || !wanted.has(match[1])) {
            zip.readEntry();
            return;
          }
          if (entry.uncompressedSize > 64 * 1024 * 1024) {
            fail(new Error(`Company JSON exceeds 64 MiB: ${entry.fileName}`));
            return;
          }
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              fail(error ?? new Error('Unable to read ZIP entry'));
              return;
            }
            void (async () => {
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of stream) {
                const buffer = Buffer.from(chunk);
                size += buffer.length;
                if (size > 64 * 1024 * 1024)
                  throw new Error('Company JSON exceeds memory limit');
                chunks.push(buffer);
              }
              const raw: unknown = JSON.parse(
                Buffer.concat(chunks).toString('utf8'),
              );
              if (
                !isObject(raw) ||
                String(raw.cik).padStart(10, '0') !== match[1] ||
                !isObject(raw.facts)
              )
                throw new Error(`Invalid company facts: ${entry.fileName}`);
              if (summaries.has(match[1]))
                throw new Error(`Duplicate CIK in archive: ${match[1]}`);
              summaries.set(match[1], summarizeAnnualFacts(raw));
              if (summaries.size % 100 === 0) progress(summaries.size);
              await setImmediate();
              if (!failed) zip.readEntry();
            })().catch(fail);
          });
        });
        zip.readEntry();
      },
    );
  });
  if (
    !summaries.size ||
    ![...summaries.values()].some((item) => item.periodEnd !== null)
  )
    throw new Error(
      'Archive contains no supported annual financial data for the ticker mapping; previous snapshot was not replaced',
    );
  const empty = summarizeAnnualFacts(null);
  const companies: SnapshotRow[] = tickers.map(({ ticker, cik }) => ({
    ticker,
    cik,
    ...(summaries.get(cik) ?? empty),
  }));
  return {
    schemaVersion: 1,
    source: 'SEC',
    updatedAt: new Date().toISOString(),
    companies,
  };
}
