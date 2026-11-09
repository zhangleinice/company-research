import { CompanyUpdateService } from '../src/modules/ai-research/company-update.service';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AiResearchController,
  CompanyUpdateController,
} from '../src/modules/ai-research/ai-research.module';
import { AiResearchService } from '../src/modules/ai-research/ai-research.service';
import { configureApp } from '../src/setup';
describe('AI HTTP boundary', () => {
  let app: INestApplication;
  const service = {
    state: jest.fn().mockResolvedValue({
      status: 'NOT_GENERATED',
      summary: null,
      error: null,
    }),
    generate: jest.fn().mockResolvedValue({ status: 'READY', cached: true }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AiResearchController, CompanyUpdateController],
      providers: [
        { provide: AiResearchService, useValue: service },
        {
          provide: CompanyUpdateService,
          useValue: {
            state: jest.fn().mockResolvedValue({ status: 'IDLE' }),
            start: jest.fn().mockResolvedValue({ status: 'QUEUED' }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('passively reads CIK cache without starting generation', async () => {
    await request(app.getHttpServer())
      .get('/api/companies/0001652044/ai/business')
      .expect(200)
      .expect({ status: 'NOT_GENERATED', summary: null, error: null });
    expect(service.state).toHaveBeenCalledWith('0001652044', 'business');
    expect(service.generate).not.toHaveBeenCalled();
  });
  it('blocks retired per-module POSTs and acknowledges unified work without awaiting AI', async () => {
    await request(app.getHttpServer())
      .post('/api/companies/GOOGL/ai/management')
      .send({ force: true })
      .expect(400);
    expect(service.generate).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/companies/0001652044/updates')
      .expect(202)
      .expect({ status: 'QUEUED' });
    await request(app.getHttpServer())
      .post('/api/companies/0001652044/updates/initialize')
      .expect(202);
    await request(app.getHttpServer())
      .get('/api/companies/0001652044/updates')
      .expect(200)
      .expect({ status: 'IDLE' });
  });
  it('rejects invalid section, passive ticker and nonboolean force', async () => {
    await request(app.getHttpServer())
      .get('/api/companies/GOOGL/ai/business')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/companies/GOOGL/ai/valuation')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/companies/GOOGL/ai/business')
      .send({ force: 'false' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/companies/GOOGL/ai/business')
      .send({ model: 'anything' })
      .expect(400);
  });
});
