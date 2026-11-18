import { Injectable, Logger } from '@nestjs/common';
import { companyWebsite, type CompanyWebsites } from '@company-research/shared';
import { SecService, normalizeCik } from '../sec/sec.service';
import { PrismaService } from '../prisma/prisma.service';
const SUCCESS_TTL = 30 * 24 * 60 * 60 * 1000;
const RETRY_TTL = 5 * 60 * 1000;
const empty = (): CompanyWebsites => ({ website: null, investorWebsite: null });
@Injectable()
export class CompanyLinksService {
  private readonly logger = new Logger(CompanyLinksService.name);
  private readonly pending = new Map<string, Promise<CompanyWebsites>>();
  private readonly cache = new Map<
    string,
    { value: CompanyWebsites; until: number }
  >();
  constructor(
    private readonly sec: SecService,
    private readonly db: PrismaService,
  ) {}
  async get(cik: string): Promise<CompanyWebsites> {
    const key = normalizeCik(cik);
    const memo = this.cache.get(key);
    if (memo && memo.until > Date.now()) return memo.value;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.load(key).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  private remember(cik: string, value: CompanyWebsites, until: number) {
    this.cache.delete(cik);
    if (this.cache.size >= 500)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cik, { value, until });
    return value;
  }
  private async load(cik: string): Promise<CompanyWebsites> {
    let stale = empty();
    try {
      const stored = await this.db.company.findUnique({
        where: { cik },
        select: { website: true, investorWebsite: true, linksCheckedAt: true },
      });
      if (stored)
        stale = {
          website: companyWebsite(stored.website),
          investorWebsite: companyWebsite(stored.investorWebsite),
        };
      const until = stored?.linksCheckedAt
        ? stored.linksCheckedAt.getTime() + SUCCESS_TTL
        : 0;
      // A successful response with no website is also a valid, expiring cache entry.
      if (until > Date.now()) return this.remember(cik, stale, until);
      const links = await this.sec.getCompanyWebsites(cik);
      const value = {
        website: companyWebsite(links.website),
        investorWebsite: companyWebsite(links.investorWebsite),
      };
      const checkedAt = new Date();
      // Only update the existing company's optional profile fields, never financials/favorites.
      await this.db.company.updateMany({
        where: { cik },
        data: { ...value, linksCheckedAt: checkedAt },
      });
      return this.remember(cik, value, checkedAt.getTime() + SUCCESS_TTL);
    } catch {
      this.logger.warn(
        `Company website lookup unavailable for CIK ${cik}; will retry later`,
      );
      // Failure never overwrites a successful database result or advances its checked timestamp.
      return this.remember(cik, stale, Date.now() + RETRY_TTL);
    }
  }
}
