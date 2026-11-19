import {
  historicalEffectiveTaxRate,
  cachedQuality,
} from '../src/modules/valuation/enterprise-quality';
import { ValuationController } from '../src/modules/valuation/valuation.module';
import type {
  ValuationFact,
  ValuationBaseline,
} from '@company-research/shared';
const fact = (value: number | null, accn = 'same'): ValuationFact => ({
  value,
  start: '2025-10-01',
  end: '2026-09-30',
  concept: 'test',
  items: [{ accn, start: '2025-10-01', end: '2026-09-30', unit: 'USD' }],
});
it('computes only a historical ETR using matched periods and accession tuples; preserves explicit zero and null', () => {
  expect(historicalEffectiveTaxRate(fact(20), fact(100))).toBe(0.2);
  expect(historicalEffectiveTaxRate(fact(0), fact(100))).toBe(0);
  expect(historicalEffectiveTaxRate(fact(null), fact(100))).toBeNull();
  expect(historicalEffectiveTaxRate(fact(20), fact(0))).toBeNull();
  expect(historicalEffectiveTaxRate(fact(20), fact(-1))).toBeNull();
  expect(historicalEffectiveTaxRate(fact(20), fact(100, 'other'))).toBeNull();
  expect(
    historicalEffectiveTaxRate(fact(20), { ...fact(100), start: '2025-01-01' }),
  ).toBeNull();
});
it('partial legacy cache preserves known facts, without zero defaults or unsupported economic results', () => {
  const baseline = {
    cik: '0000000001',
    applicable: true,
    asOf: '2026-09-30',
    ocf: fact(20),
    capex: fact(0),
    ebit: fact(15),
  } as ValuationBaseline;
  const partial = cachedQuality('TEST', baseline);
  expect(partial.capex.value).toBe(0);
  expect(partial.netIncome.value).toBeNull();
  expect(partial.depreciationAmortization.value).toBeNull();
  expect(partial.historicalTaxRate).toBeNull();
  expect(partial.capital).toEqual([]);
  expect(partial).not.toHaveProperty('roic');
  expect(partial).not.toHaveProperty('ownerEarnings');
  expect(cachedQuality('TEST', null).applicable).toBeNull();
});
it('quality route reads caches without invoking the SEC client, resolver, or a database write', async () => {
  const sec = { resolveCompany: jest.fn(), getCompanyFacts: jest.fn() };
  const client = { getJson: jest.fn() };
  const db = {
    company: { findFirst: jest.fn().mockResolvedValue(null) },
    valuationCache: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const controller = new ValuationController(
    sec as never,
    client as never,
    db as never,
  );
  const result = await controller.quality('MSFT');
  expect(result.ticker).toBe('MSFT');
  expect(result.capex.value).toBeNull();
  expect(sec.resolveCompany).not.toHaveBeenCalled();
  expect(sec.getCompanyFacts).not.toHaveBeenCalled();
  expect(client.getJson).not.toHaveBeenCalled();
  await expect(controller.quality('bad/path')).rejects.toThrow('无效公司代码');
});
