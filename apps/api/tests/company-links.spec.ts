import { CompanyLinksService } from '../src/modules/company/company-links.service';
import { SecService } from '../src/modules/sec/sec.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
function setup(
  row: {
    website: string | null;
    investorWebsite: string | null;
    linksCheckedAt: Date | null;
  } | null = null,
) {
  const sec = {
    getCompanyWebsites: jest
      .fn()
      .mockResolvedValue({
        website: 'https://example.com/',
        investorWebsite: 'https://ir.example.com/',
      }),
  };
  const db = {
    company: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new CompanyLinksService(
    sec as unknown as SecService,
    db as unknown as PrismaService,
  );
  return { sec, db, service };
}
afterEach(() => jest.restoreAllMocks());
it('normalizes CIK, deduplicates concurrent aliases and saves only optional profile fields', async () => {
  const { sec, db, service } = setup();
  const [a, b] = await Promise.all([
    service.get('1652044'),
    service.get('0001652044'),
  ]);
  expect(a).toEqual(b);
  expect(sec.getCompanyWebsites).toHaveBeenCalledTimes(1);
  expect(sec.getCompanyWebsites).toHaveBeenCalledWith('0001652044');
  expect(db.company.updateMany).toHaveBeenCalledWith({
    where: { cik: '0001652044' },
    data: {
      website: 'https://example.com/',
      investorWebsite: 'https://ir.example.com/',
      linksCheckedAt: expect.any(Date),
    },
  });
});
it('reads persistent fresh cache including empty results without SEC requests, even after a new service instance', async () => {
  for (const ir of [null, 'https://ir.example.com/']) {
    const { sec, db, service } = setup({
      website: null,
      investorWebsite: ir,
      linksCheckedAt: new Date(),
    });
    expect((await service.get('1652044')).investorWebsite).toBe(ir);
    await new CompanyLinksService(
      sec as unknown as SecService,
      db as unknown as PrismaService,
    ).get('1652044');
    expect(sec.getCompanyWebsites).not.toHaveBeenCalled();
    expect(db.company.updateMany).not.toHaveBeenCalled();
  }
});
it('expires successful empty results after 30 days and refetches instead of permanently hiding the link', async () => {
  let now = Date.parse('2026-11-18T00:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const { sec, service } = setup({
    website: null,
    investorWebsite: null,
    linksCheckedAt: new Date(now),
  });
  expect((await service.get('1652044')).investorWebsite).toBeNull();
  now += 30 * 86400000 + 1;
  expect((await service.get('1652044')).investorWebsite).toBe(
    'https://ir.example.com/',
  );
  expect(sec.getCompanyWebsites).toHaveBeenCalledTimes(1);
});
it('a failed request preserves stale links and timestamp, retries after a short backoff, and never touches finance or favorites', async () => {
  let now = Date.parse('2026-11-18T00:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const row = {
    website: 'https://example.com/',
    investorWebsite: 'https://old.example.com/',
    linksCheckedAt: new Date(now - 31 * 86400000),
  };
  const { sec, db, service } = setup(row);
  sec.getCompanyWebsites.mockRejectedValueOnce(Error('SEC unavailable'));
  expect((await service.get('1652044')).investorWebsite).toBe(
    row.investorWebsite,
  );
  await service.get('0001652044');
  expect(sec.getCompanyWebsites).toHaveBeenCalledTimes(1);
  expect(db.company.updateMany).not.toHaveBeenCalled();
  expect(row.linksCheckedAt.getTime()).toBe(now - 31 * 86400000);
  now += 5 * 60000 + 1;
  expect((await service.get('1652044')).investorWebsite).toBe(
    'https://ir.example.com/',
  );
  expect(sec.getCompanyWebsites).toHaveBeenCalledTimes(2);
});
it('returns quiet null links for a first request failure and does not persist failure as a successful empty result', async () => {
  const { sec, db, service } = setup();
  sec.getCompanyWebsites.mockRejectedValue(Error('SEC unavailable'));
  expect(await service.get('1652044')).toEqual({
    website: null,
    investorWebsite: null,
  });
  expect(db.company.updateMany).not.toHaveBeenCalled();
});
it('sanitizes stored and fetched URLs, with no fallback from company homepage to an invented IR address', async () => {
  const { sec, service } = setup();
  sec.getCompanyWebsites.mockResolvedValue({
    website: 'https://example.com/',
    investorWebsite: 'javascript:alert(1)',
  });
  expect(await service.get('1652044')).toEqual({
    website: 'https://example.com/',
    investorWebsite: null,
  });
});
