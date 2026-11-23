import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { SecClient } from '../src/modules/sec/sec.client';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { CompanyController } from '../src/modules/company/company.controller';
import { CompanyService } from '../src/modules/company/company.service';
import { CompanyLinksService } from '../src/modules/company/company-links.service';
import { FinancialService } from '../src/modules/financials/financial.service';
import { SecService } from '../src/modules/sec/sec.service';
import { FINANCIAL_METRICS } from '@company-research/shared';

describe('company directory HTTP boundaries', () => {
  let app: INestApplication;
  const getJson = jest.fn(async (url: string) => {
    if (!url.includes('company_tickers'))
      throw new Error('Unexpected upstream request');
    return {
      0: { ticker: 'GOOG', cik_str: 1652044, title: 'Alphabet Inc.' },
      1: { ticker: 'AAPL', cik_str: 320193, title: 'Apple Inc.' },
      2: { ticker: 'KO', cik_str: 21344, title: 'Coca-Cola Co.' },
    };
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SecClient)
      .useValue({ getJson })
      .overrideProvider(PrismaService)
      .useValue({ company: { findMany: jest.fn(async () => []) } })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app?.close());
  it('defaults to ten rows and merges no invented financial values', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/companies')
      .expect(200);
    expect(response.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 3,
      mode: 'annual',
    });
    expect(response.body.data[0]).toMatchObject({
      ticker: 'GOOG',
      financial: null,
      financialStatus: 'NOT_FETCHED',
    });
  });
  it('supports name search and quarterly mode without Company Facts requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/companies?q=Apple&mode=quarterly')
      .expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].ticker).toBe('AAPL');
    expect(
      getJson.mock.calls.every(([url]) =>
        String(url).includes('company_tickers'),
      ),
    ).toBe(true);
  });
  it('provides a basic search endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/companies/search?q=KO')
      .expect(200);
    expect(response.body).toEqual([
      { ticker: 'KO', cik: '0000021344', name: 'Coca-Cola Co.' },
    ]);
  });
  it.each(['page=0', 'mode=invalid'])(
    'rejects invalid parameters %s',
    async (query) => {
      await request(app.getHttpServer())
        .get(`/api/companies?${query}`)
        .expect(400);
    },
  );
});

describe('cached annual capital-allocation HTTP contract', () => {
  let app: INestApplication;
  const upstream = jest.fn(() => {
    throw new Error('Cached details must not acquire SEC data');
  });
  beforeAll(async () => {
    const values = {
      sharesOutstanding: 12088000000,
      stockRepurchases: 45709000000,
      operatingCashFlow: 164713000000,
      capex: 91447000000,
      fcf: 73266000000,
    };
    const tags = {
      sharesOutstanding: 'CommonStockSharesOutstanding',
      stockRepurchases: 'PaymentsForRepurchaseOfCommonStock',
      operatingCashFlow: 'NetCashProvidedByUsedInOperatingActivities',
      capex: 'PaymentsToAcquirePropertyPlantAndEquipment',
    };
    const sources = Object.fromEntries(
      Object.entries(tags).map(([key, tag]) => [
        key,
        {
          method: 'reported',
          items: [
            {
              concept: `us-gaap:${tag}`,
              val: values[key as keyof typeof values],
              unit: key === 'sharesOutstanding' ? 'shares' : 'USD',
              ...(key === 'sharesOutstanding' ? {} : { start: '2025-01-01' }),
              end: '2025-12-31',
              accn:
                key === 'sharesOutstanding'
                  ? '0001652044-26-000084'
                  : '0001652044-26-000018',
              filed: key === 'sharesOutstanding' ? '2026-10-29' : '2026-02-05',
              form: key === 'sharesOutstanding' ? '10-Q' : '10-K',
            },
          ],
        },
      ]),
    );
    const row = {
      ...Object.fromEntries(FINANCIAL_METRICS.map((key) => [key, null])),
      ...values,
      companyCik: '0001652044',
      periodStart: new Date('2025-01-01'),
      periodEnd: new Date('2025-12-31'),
      fiscalYear: 2025,
      fiscalQuarter: null,
      currency: 'USD',
      sources,
    };
    const company = {
      cik: '0001652044',
      ticker: 'GOOGL',
      name: 'Alphabet Inc.',
      id: 'cached',
      industry: null,
      isFavorite: false,
      financialStatus: 'READY',
      lastFetchedAt: new Date('2026-11-09'),
      lastError: null,
      annualFinancials: [row],
      quarterlyFinancials: [],
    };
    const module = await Test.createTestingModule({
      controllers: [CompanyController],
      providers: [
        CompanyService,
        FinancialService,
        { provide: CompanyLinksService, useValue: {} },
        {
          provide: SecService,
          useValue: { resolveCompany: upstream, getCompanyFacts: upstream },
        },
        {
          provide: PrismaService,
          useValue: {
            company: {
              findFirst: async () => company,
              createMany: async () => ({ count: 0 }),
              findUniqueOrThrow: async () => company,
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => app?.close());
  it.each(['GOOGL', '0001652044'])(
    'serializes verified shares and buyback/FCF through the real controller for %s',
    async (identifier) => {
      const response = await request(app.getHttpServer())
        .get(`/api/companies/${identifier}`)
        .expect(200);
      const row = response.body.annual[0];
      expect(row.sharesOutstanding).toBe(12088000000);
      expect(row.capitalAllocation.sharesOutstanding.value).toBe(12088000000);
      expect(row.capitalAllocation.sharesOutstanding.sources[0].end).toBe(
        '2025-12-31',
      );
      expect(row.capitalAllocation.buybackToFcf.value).toBeCloseTo(
        62.387737832,
      );
      expect(upstream).not.toHaveBeenCalled();
    },
  );
});
