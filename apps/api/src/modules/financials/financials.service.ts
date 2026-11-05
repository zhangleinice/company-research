import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FinancialListResponse } from '@company-research/shared';
import { isObject } from './annual-financials';
import { dataDirectory, type FinancialSnapshot } from './snapshot';

@Injectable()
export class FinancialsService {
  private readonly logger = new Logger(FinancialsService.name);
  private readonly path: string;
  private snapshot?: FinancialSnapshot;
  private signature = '';
  private refreshing?: Promise<void>;
  private unavailable = false;
  private warning?: string;

  constructor(config: ConfigService) {
    this.path = join(
      dataDirectory(config.get<string>('SEC_DATA_DIR')),
      'financials.json',
    );
  }

  async getCompanies(
    page: number,
    limit: number,
  ): Promise<FinancialListResponse> {
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    await this.refreshing;
    if (!this.snapshot)
      return {
        source: 'SEC',
        status: this.unavailable ? 'unavailable' : 'not_initialized',
        updatedAt: null,
        total: 0,
        page,
        limit,
        data: [],
      };
    const data = this.snapshot.companies
      .slice((page - 1) * limit, page * limit)
      .map((row) => ({
        ticker: row.ticker,
        fiscalYear: row.fiscalYear,
        periodEnd: row.periodEnd,
        currency: row.currency,
        revenue: row.revenue,
        revenueGrowth: row.revenueGrowth,
        netIncome: row.netIncome,
        netMargin: row.netMargin,
        operatingCashFlow: row.operatingCashFlow,
        capitalExpenditure: row.capitalExpenditure,
        freeCashFlow: row.freeCashFlow,
      }));
    return {
      source: 'SEC',
      status: 'ready',
      updatedAt: this.snapshot.updatedAt,
      total: this.snapshot.companies.length,
      page,
      limit,
      data,
      ...(this.warning ? { warning: this.warning } : {}),
    };
  }

  private async refresh(): Promise<void> {
    try {
      const info = await stat(this.path);
      const signature = `${info.mtimeMs}:${info.size}`;
      if (signature === this.signature) return;
      if (info.size > 100 * 1024 * 1024)
        throw new Error('Summary file exceeds 100 MiB');
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        !isObject(raw) ||
        raw.schemaVersion !== 1 ||
        raw.source !== 'SEC' ||
        typeof raw.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(raw.updatedAt)) ||
        !Array.isArray(raw.companies) ||
        !raw.companies.length
      )
        throw new Error('Invalid summary file');
      const tickers = new Set<string>();
      for (const row of raw.companies) {
        if (
          !isObject(row) ||
          typeof row.ticker !== 'string' ||
          !row.ticker ||
          tickers.has(row.ticker) ||
          !/^\d{10}$/.test(String(row.cik)) ||
          !(row.fiscalYear === null || Number.isInteger(row.fiscalYear)) ||
          !(
            row.periodEnd === null ||
            (typeof row.periodEnd === 'string' &&
              /^\d{4}-\d{2}-\d{2}$/.test(row.periodEnd) &&
              Number.isFinite(Date.parse(row.periodEnd)))
          ) ||
          !(row.currency === 'USD' || row.currency === null) ||
          ![
            'revenue',
            'revenueGrowth',
            'netIncome',
            'netMargin',
            'operatingCashFlow',
            'capitalExpenditure',
            'freeCashFlow',
          ].every(
            (key) =>
              row[key] === null ||
              (typeof row[key] === 'number' && Number.isFinite(row[key])),
          )
        )
          throw new Error('Invalid financial row');
        tickers.add(row.ticker);
      }
      this.snapshot = raw as unknown as FinancialSnapshot;
      this.signature = signature;
      this.unavailable = false;
      this.warning = undefined;
    } catch (error) {
      this.unavailable = (error as NodeJS.ErrnoException).code !== 'ENOENT';
      if (this.snapshot)
        this.warning = '新摘要暂不可用，正在展示上一次成功加载的数据';
      if (this.unavailable)
        this.logger.warn(
          'Financial summary could not be loaded; previous valid data is retained',
        );
    }
  }
}
