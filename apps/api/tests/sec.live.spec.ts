import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { SecService } from '../src/modules/sec/sec.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const live = process.env.RUN_SEC_LIVE === '1' ? describe : describe.skip;
live('SEC + PostgreSQL live acceptance (preserves existing user data)', () => {
  let app: INestApplication;
  let sec: SecService;
  let prisma: PrismaService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    sec = app.get(SecService);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app?.close());
  it('searches and lists without Company Facts requests', async () => {
    const spy = jest.spyOn(sec, 'getCompanyFacts');
    await request(app.getHttpServer())
      .get('/api/companies/search?q=GOOG')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/companies?page=1&mode=quarterly')
      .expect(200);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }, 40000);
  it.each([
    ['GOOG', '0001652044'],
    ['AAPL', '0000320193'],
    ['KO', '0000021344'],
  ])(
    'acquires and caches %s',
    async (ticker, cik) => {
      const first = await request(app.getHttpServer())
        .get(`/api/companies/${ticker}`)
        .expect(200);
      expect(first.body).toMatchObject({ cik, financialStatus: 'READY' });
      expect(first.body.annual.length).toBeGreaterThan(0);
      expect(first.body.annual.length).toBeLessThanOrEqual(10);
      expect(first.body.quarterly.length).toBeLessThanOrEqual(10);
      const spy = jest.spyOn(sec, 'getCompanyFacts');
      const next = await request(app.getHttpServer())
        .get(`/api/companies/${ticker}`)
        .expect(200);
      expect(next.body.lastFetchedAt).toBe(first.body.lastFetchedAt);
      expect(spy).not.toHaveBeenCalled();
      expect(await prisma.company.count({ where: { cik } })).toBe(1);
      spy.mockRestore();
    },
    90000,
  );
});
