import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { SecClient } from '../src/modules/sec/sec.client';
import { PrismaService } from '../src/modules/prisma/prisma.service';

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
