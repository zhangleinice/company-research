import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { FinancialsService } from '../src/modules/financials/financials.service';
import {
  publishSnapshot,
  type FinancialSnapshot,
} from '../src/modules/financials/snapshot';
import { summarizeAnnualFacts } from '../src/modules/financials/annual-financials';

describe('local financial snapshot', () => {
  let directory: string;
  let service: FinancialsService;
  const snapshot = (): FinancialSnapshot => ({
    schemaVersion: 1,
    source: 'SEC',
    updatedAt: '2026-01-01T00:00:00.000Z',
    companies: Array.from({ length: 12 }, (_, index) => ({
      ...summarizeAnnualFacts(null),
      ticker: `TEST${index}`,
      cik: String(index + 1).padStart(10, '0'),
    })),
  });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sec-snapshot-test-'));
    service = new FinancialsService(
      new ConfigService({ SEC_DATA_DIR: directory }),
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('returns an immediate initialization state when no file exists', async () => {
    expect(await service.getCompanies(1, 10)).toEqual({
      source: 'SEC',
      status: 'not_initialized',
      updatedAt: null,
      total: 0,
      page: 1,
      limit: 10,
      data: [],
    });
  });
  it('paginates ten rows, does not expose source records or CIKs, and survives a new service instance', async () => {
    await publishSnapshot(directory, snapshot());
    const first = await service.getCompanies(1, 10);
    expect(first.status).toBe('ready');
    expect(first.total).toBe(12);
    expect(first.data).toHaveLength(10);
    expect(first.data[0]).not.toHaveProperty('sources');
    expect(first.data[0]).not.toHaveProperty('cik');
    const restarted = new FinancialsService(
      new ConfigService({ SEC_DATA_DIR: directory }),
    );
    expect(
      (await restarted.getCompanies(2, 10)).data.map((x) => x.ticker),
    ).toEqual(['TEST10', 'TEST11']);
    expect((await service.getCompanies(3, 10)).data).toEqual([]);
  });
  it('reloads a complete new snapshot without restarting the API', async () => {
    await publishSnapshot(directory, snapshot());
    await service.getCompanies(1, 10);
    const next = snapshot();
    next.updatedAt = '2026-02-01T00:00:00.000Z';
    next.companies.pop();
    await publishSnapshot(directory, next);
    expect((await service.getCompanies(1, 10)).total).toBe(11);
    expect((await service.getCompanies(1, 10)).updatedAt).toBe(next.updatedAt);
  });
  it('retains the last valid in-memory summary if the file is corrupted', async () => {
    await publishSnapshot(directory, snapshot());
    await service.getCompanies(1, 10);
    await writeFile(join(directory, 'financials.json'), '{truncated');
    const result = await service.getCompanies(1, 10);
    expect(result.status).toBe('ready');
    expect(result.total).toBe(12);
    expect(result.warning).toBeDefined();
  });
  it('returns unavailable rather than invented records for an invalid file on startup', async () => {
    await writeFile(join(directory, 'financials.json'), '{}');
    expect(await service.getCompanies(1, 10)).toMatchObject({
      status: 'unavailable',
      data: [],
    });
  });
});
