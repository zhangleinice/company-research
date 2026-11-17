import {
  cleanMergerRecords,
  MergersService,
} from '../src/modules/mergers/mergers.service';
import { MergersController } from '../src/modules/mergers/mergers.module';
const row = {
  symbol: 'PEBO',
  companyName: 'Peoples Bancorp Inc.',
  cik: '0000318300',
  targetedCompanyName: 'Capital Bancorp, Inc.',
  targetedCik: '0001419536',
  targetedSymbol: 'CBNK',
  transactionDate: '2026-11-13',
  acceptedDate: '2026-11-13 21:43:52',
  link: 'https://www.sec.gov/Archives/edgar/data/318300/000119312526461409/d180264ds4.htm',
};
it('cleans observed FMP fields, deduplicates and labels every record unverified', () => {
  const records = cleanMergerRecords([
    row,
    row,
    {
      ...row,
      targetedCompanyName: 'Other target',
      targetedCik: null,
      targetedSymbol: null,
    },
    { ...row, link: 'javascript:alert(1)' },
    { ...row, transactionDate: '2026-02-30' },
  ]);
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({ ...row, status: 'UNVERIFIED' });
  expect(records[1].targetedSymbol).toBeNull();
  expect(() => cleanMergerRecords({ 'Error Message': 'forbidden' })).toThrow();
});
it('cached pagination never calls FMP or requires an API key', async () => {
  const findUnique = jest.fn().mockResolvedValue({ id: 'latest' });
  const config = { get: jest.fn() };
  const tx = {
    mergerDeal: {
      count: jest.fn().mockResolvedValue(15),
      findMany: jest.fn().mockResolvedValue([]),
    },
    mergerImport: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ checkedAt: new Date() }),
    },
  };
  const service = new MergersService(
    {
      mergerImport: { findUnique },
      $transaction: async (f: (v: unknown) => unknown) => f(tx),
    } as never,
    config as never,
  );
  expect((await service.list(2, 10)).total).toBe(15);
  expect(config.get).not.toHaveBeenCalled();
  expect(tx.mergerDeal.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ skip: 10, take: 10 }),
  );
});
it('rejects invalid pagination', () => {
  const service = { list: jest.fn() };
  const controller = new MergersController(service as never);
  expect(() => controller.list('0', '10')).toThrow();
  expect(() => controller.list('1', '101')).toThrow();
  expect(service.list).not.toHaveBeenCalled();
});
it('preserves the actual FMP subscription error while redacting the key and never writes a failed import', async () => {
  const create = jest.fn();
  const key = 'secret-test-key';
  const spy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(`Premium Query Parameter: ${key}`, { status: 402 }),
    );
  const tx = {
    mergerImport: { findUnique: jest.fn().mockResolvedValue(null), create },
    $executeRaw: jest.fn(),
  };
  const service = new MergersService(
    {
      mergerImport: tx.mergerImport,
      $transaction: async (f: (v: unknown) => unknown) => f(tx),
    } as never,
    { get: () => key } as never,
  );
  try {
    await expect(service.list(1, 10)).rejects.toThrow(
      'FMP HTTP 402: Premium Query Parameter: [REDACTED]',
    );
    expect(create).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
