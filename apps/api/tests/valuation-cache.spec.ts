import { ValuationController } from '../src/modules/valuation/valuation.module';
it('reads the existing CIK cache without fetching CompanyFacts, Submissions or AI', async () => {
  const sec = {
    resolveCompany: jest.fn().mockResolvedValue({ cik: '0001652044' }),
    getCompanyFacts: jest.fn(),
  };
  const client = { getJson: jest.fn() };
  const cached = { fcff: null, fcf: 1 };
  const db = {
    valuationCache: {
      findUnique: jest.fn().mockResolvedValue({ data: cached }),
    },
  };
  const c = new ValuationController(sec as never, client as never, db as never);
  expect(await c.baseline('GOOGL')).toEqual(expect.objectContaining(cached));
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
});
it('a failed explicit baseline refresh cannot overwrite the previous cache', async () => {
  const upsert = jest.fn();
  const db = {
    valuationCache: {
      findUnique: jest.fn().mockResolvedValue({ data: { fcf: 1 } }),
    },
    $transaction: async (work: (tx: unknown) => unknown) =>
      work({
        $executeRaw: jest.fn(),
        valuationCache: {
          findUnique: jest.fn().mockResolvedValue({ data: { fcf: 1 } }),
          upsert,
        },
      }),
  };
  const sec = {
    resolveCompany: jest.fn().mockResolvedValue({ cik: '0001652044' }),
    getCompanyFacts: jest.fn().mockRejectedValue(new Error('network')),
  };
  const c = new ValuationController(sec as never, {} as never, db as never);
  await expect(c.refresh('GOOGL')).rejects.toThrow('估值财务基准暂不可用');
  expect(upsert).not.toHaveBeenCalled();
});
it('valuation references read latest same-period financial cache without SEC or AI retrieval', async () => {
  const sec = {
    resolveCompany: jest.fn().mockResolvedValue({ cik: '0000021344' }),
    getCompanyFacts: jest.fn(),
  };
  const client = { getJson: jest.fn() };
  const db = {
    valuationCache: { findUnique: jest.fn().mockResolvedValue(null) },
    quarterlyFinancial: {
      findFirst: jest.fn().mockResolvedValue({
        periodEnd: new Date('2026-10-02'),
        cash: '13454000000',
        totalDebt: '41619000000',
        dilutedShares: '4314000000',
        sharesOutstanding: null,
        sources: {
          totalDebt: { formula: 'current+noncurrent' },
          revenue: { val: 1 },
        },
      }),
    },
    annualFinancial: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ periodEnd: new Date('2025-12-31') }),
    },
  };
  const c = new ValuationController(sec as never, client as never, db as never);
  const refs = await c.references('KO');
  expect(refs.periodEnd).toBe('2026-10-02');
  expect(refs.cash).toBe(13454000000);
  expect(refs.debt).toBe(41619000000);
  expect(refs.sharesBasis).toBe('weightedDiluted');
  expect(refs.sources).not.toHaveProperty('revenue');
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
});
it('missing financial reference rows remain null, with no acquisition fallback', async () => {
  const sec = {
    resolveCompany: jest.fn().mockResolvedValue({ cik: '0000021344' }),
    getCompanyFacts: jest.fn(),
  };
  const db = {
    valuationCache: { findUnique: jest.fn().mockResolvedValue(null) },
    quarterlyFinancial: { findFirst: jest.fn().mockResolvedValue(null) },
    annualFinancial: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const c = new ValuationController(sec as never, {} as never, db as never);
  const r = await c.references('KO');
  expect(r.cash).toBeNull();
  expect(r.debt).toBeNull();
  expect(r.shares).toBeNull();
  expect(r.sharesBasis).toBe('unknown');
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
});
