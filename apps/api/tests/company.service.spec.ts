import { BadRequestException } from '@nestjs/common';
import { CompanyService } from '../src/modules/company/company.service';
import { SecService } from '../src/modules/sec/sec.service';
import { FinancialService } from '../src/modules/financials/financial.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const directory = [
  { ticker: 'GOOG', cik: '0001652044', name: 'Alphabet Inc.' },
  { ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.' },
  { ticker: 'KO', cik: '0000021344', name: 'Coca-Cola Co.' },
];
function facts(cik: string) {
  return {
    cik,
    facts: {
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              {
                val: 120,
                start: '2025-01-01',
                end: '2025-12-31',
                filed: '2026-02-01',
                form: '10-K',
                fp: 'FY',
                fy: 2025,
                accn: 'fixture',
              },
            ],
          },
        },
      },
    },
  };
}
function setup() {
  type Row = Record<string, unknown> & {
    cik: string;
    ticker: string;
    financialStatus: string;
    annualFinancials: Record<string, unknown>[];
    quarterlyFinancials: Record<string, unknown>[];
  };
  const rows = new Map<string, Row>();
  const model = {
    findFirst: jest.fn(
      async ({ where }) =>
        [...rows.values()].find((row) =>
          where.cik ? row.cik === where.cik : row.ticker === where.ticker,
        ) ?? null,
    ),
    findUniqueOrThrow: jest.fn(async ({ where }) => {
      const row = rows.get(where.cik);
      if (!row) throw new Error('not found');
      return row;
    }),
    upsert: jest.fn(async ({ where, create, update }) => {
      let row = rows.get(where.cik);
      if (!row) {
        row = {
          id: where.cik,
          isFavorite: false,
          financialStatus: 'NOT_FETCHED',
          lastFetchedAt: null,
          industry: null,
          lastError: null,
          annualFinancials: [],
          quarterlyFinancials: [],
          ...create,
        };
        rows.set(where.cik, row as Row);
      }
      Object.assign(row!, update);
      return row;
    }),
    createMany: jest.fn(async ({ data }) => {
      for (const create of data) {
        if (!rows.has(create.cik))
          rows.set(create.cik, {
            id: create.cik,
            isFavorite: false,
            financialStatus: 'NOT_FETCHED',
            lastFetchedAt: null,
            industry: null,
            lastError: null,
            annualFinancials: [],
            quarterlyFinancials: [],
            ...create,
          });
      }
      return { count: data.length };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const row = rows.get(where.cik);
      if (!row) return { count: 0 };
      if (where.fetchToken && row.fetchToken !== where.fetchToken)
        return { count: 0 };
      if (
        where.OR &&
        (row.financialStatus === 'READY' || row.financialStatus === 'FETCHING')
      )
        return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findMany: jest.fn(async ({ where }) =>
      [...rows.values()].filter((row) =>
        where.cik ? where.cik.in.includes(row.cik) : row.isFavorite,
      ),
    ),
    count: jest.fn(
      async () => [...rows.values()].filter((row) => row.isFavorite).length,
    ),
  };
  const upsertPeriod = (key: 'annualFinancials' | 'quarterlyFinancials') =>
    jest.fn(async ({ create }) => {
      const row = rows.get(create.companyCik)!;
      const previous = row[key].find(
        (x) => (x.periodEnd as Date).getTime() === create.periodEnd.getTime(),
      );
      if (previous) Object.assign(previous, create);
      else row[key].push(create);
      return create;
    });
  const db = {
    company: model,
    annualFinancial: { upsert: upsertPeriod('annualFinancials') },
    quarterlyFinancial: { upsert: upsertPeriod('quarterlyFinancials') },
    $transaction: jest.fn(async (operation: unknown): Promise<unknown> =>
      typeof operation === 'function'
        ? operation(db)
        : Promise.all(operation as Promise<unknown>[]),
    ),
  };
  const sec = {
    getCompanies: jest.fn(async (page: number, limit: number, q = '') => {
      const data = directory.filter(
        (x) =>
          !q ||
          x.ticker.toLowerCase().includes(q.toLowerCase()) ||
          x.name.toLowerCase().includes(q.toLowerCase()),
      );
      return {
        source: 'SEC',
        total: data.length,
        page,
        limit,
        data: data.slice((page - 1) * limit, page * limit),
      };
    }),
    resolveCompany: jest.fn(async (input: string) =>
      input === 'GOOGL'
        ? { ...directory[0], ticker: 'GOOGL' }
        : directory.find((x) => x.ticker === input || x.cik === input)!,
    ),
    getCompanyFacts: jest.fn(async (cik: string) => facts(cik)),
    getCompany: jest.fn(async () => ({
      ...directory[0],
      industry: 'Fixture industry',
    })),
  };
  const service = new CompanyService(
    sec as unknown as SecService,
    new FinancialService(),
    db as unknown as PrismaService,
  );
  return { service, sec, db, rows };
}

describe('company directory and on-demand cache boundaries', () => {
  it('lists/searches the full basic directory with null financials without calling Company Facts', async () => {
    const { service, sec } = setup();
    const all = await service.getCompanies(1, 10);
    expect(all.total).toBe(3);
    expect(all.data[0]).toMatchObject({
      financial: null,
      financialStatus: 'NOT_FETCHED',
      isFavorite: false,
    });
    expect((await service.getCompanies(1, 10, 'Apple')).total).toBe(1);
    expect((await service.search('KO'))[0].ticker).toBe('KO');
    expect(sec.getCompanyFacts).not.toHaveBeenCalled();
    expect(sec.getCompany).not.toHaveBeenCalled();
  });
  it.each(directory)(
    'fetches $ticker once and reuses the saved data on repeated detail reads',
    async (company) => {
      const { service, sec, db } = setup();
      const first = await service.getCompany(company.ticker);
      expect(first.financialStatus).toBe('READY');
      expect(first.annual[0].revenue).toBe(120);
      expect(sec.getCompanyFacts).toHaveBeenCalledWith(company.cik);
      await service.getCompany(company.ticker);
      const afterRestart = new CompanyService(
        sec as unknown as SecService,
        new FinancialService(),
        db as unknown as PrismaService,
      );
      await afterRestart.getCompany(company.ticker);
      expect(sec.getCompanyFacts).toHaveBeenCalledTimes(1);
      const list = await afterRestart.getCompanies(1, 10);
      expect(
        list.data.find((x) => x.cik === company.cik)?.financial?.revenue,
      ).toBe(120);
    },
  );
  it('shares cache across CIK aliases and simultaneous detail requests', async () => {
    const { service, sec, rows } = setup();
    await Promise.all([
      service.getCompany('GOOG'),
      service.getCompany('GOOGL'),
      service.getCompany('GOOG'),
    ]);
    expect(sec.getCompanyFacts).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
  });
  it('favorites an unfetched company without downloading data, then unfavorites without deleting cached financials', async () => {
    const { service, sec, rows } = setup();
    await service.setFavorite('0001652044', true);
    expect(sec.getCompanyFacts).not.toHaveBeenCalled();
    expect(
      (await service.getCompanies(1, 10, '', 'annual', true)).data[0],
    ).toMatchObject({ isFavorite: true, financialStatus: 'NOT_FETCHED' });
    await service.getCompany('GOOG');
    await service.setFavorite('0001652044', false);
    expect(rows.get('0001652044')!.annualFinancials).toHaveLength(1);
    expect((await service.getCompanies(1, 10, '', 'annual', true)).total).toBe(
      0,
    );
  });
  it('marks a failed fetch as retryable and never marks it READY or writes period rows', async () => {
    const { service, sec, rows } = setup();
    sec.getCompanyFacts.mockRejectedValueOnce(
      new Error('SEC connection timeout'),
    );
    await expect(service.getCompany('KO')).rejects.toThrow('timeout');
    expect(rows.get('0000021344')).toMatchObject({
      financialStatus: 'FAILED',
      fetchToken: null,
      annualFinancials: [],
    });
    expect((await service.getCompany('KO')).financialStatus).toBe('READY');
    expect(sec.getCompanyFacts).toHaveBeenCalledTimes(2);
  });
  it('does not steal an active import owned by another process', async () => {
    const { service, sec, rows } = setup();
    await service.setFavorite('0001652044', true);
    Object.assign(rows.get('0001652044')!, {
      financialStatus: 'FETCHING',
      fetchToken: 'other-process',
      fetchStartedAt: new Date(),
    });
    expect((await service.getCompany('GOOG')).financialStatus).toBe('FETCHING');
    expect(sec.getCompanyFacts).not.toHaveBeenCalled();
  });
  it('validates pagination, mode and favorite payloads', async () => {
    const { service } = setup();
    await expect(service.getCompanies(0, 10)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getCompanies(1, 10, '', 'invalid')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.setFavorite('KO', 'true')).rejects.toThrow(
      BadRequestException,
    );
  });
});
