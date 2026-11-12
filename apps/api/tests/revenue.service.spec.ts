import {
  RevenueService,
  REVENUE_PARSER_VERSION,
} from '../src/modules/revenue/revenue.service';
import { RevenueController } from '../src/modules/revenue/revenue.module';
import { BadRequestException } from '@nestjs/common';
it.each(['READY', 'EMPTY', 'FAILED'])(
  'ordinary %s cache read does not fetch SEC or parse again',
  async (status) => {
    const record = {
      companyCik: '0001652044',
      status,
      checkedAt: new Date(),
      data: [],
      accessionNumber: 'old',
      extractedAt: new Date(),
      parserVersion: REVENUE_PARSER_VERSION,
    };
    const db = {
      company: {
        findUnique: jest.fn().mockResolvedValue({ cik: record.companyCik }),
      },
      revenueBreakdownCache: {
        findUnique: jest.fn().mockResolvedValue(record),
        createMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const sec = { getJson: jest.fn(), getText: jest.fn() };
    const service = new RevenueService(db as never, sec as never);
    expect((await service.ensure(record.companyCik)).status).toBe(status);
    expect(sec.getJson).not.toHaveBeenCalled();
    expect(sec.getText).not.toHaveBeenCalled();
    expect(db.revenueBreakdownCache.createMany).not.toHaveBeenCalled();
  },
);
it('shares concurrent submissions and HTML acquisition with the AI filing path', async () => {
  const data = {
    cik: 1652044,
    filings: {
      recent: {
        form: ['10-K'],
        accessionNumber: ['0001652044-26-000018'],
        primaryDocument: ['goog-20251231.htm'],
        reportDate: ['2025-12-31'],
        filingDate: ['2026-02-05'],
      },
    },
  };
  const sec = {
    getJson: jest.fn().mockResolvedValue(data),
    getText: jest.fn().mockResolvedValue('<html/>'),
  };
  const service = new RevenueService({} as never, sec as never);
  const [a, b] = await Promise.all([
    service.metadata('0001652044'),
    service.metadata('0001652044'),
  ]);
  expect(a).toEqual(b);
  expect(sec.getJson).toHaveBeenCalledTimes(1);
  await Promise.all([service.html(a), service.html(b)]);
  expect(sec.getText).toHaveBeenCalledTimes(1);
});
it('rejects invalid cache CIK before service work', () => {
  const ensure = jest.fn();
  const controller = new RevenueController({ ensure } as never);
  expect(() => controller.get('GOOGL')).toThrow(BadRequestException);
  expect(ensure).not.toHaveBeenCalled();
});
