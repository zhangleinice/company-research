import { RevenueModule } from '../revenue/revenue.module';
import {
  Module,
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { CompanyUpdateService } from './company-update.service';
import { SecModule } from '../sec/sec.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiResearchService } from './ai-research.service';
import { SummaryModel } from './summary-model';
import type { SummaryKind } from './summary-schema';
const kind = (value: string): SummaryKind => {
  if (value !== 'business' && value !== 'management')
    throw new BadRequestException('Unknown AI section');
  return value;
};
@Controller('companies/:identifier/ai')
export class AiResearchController {
  constructor(private readonly service: AiResearchService) {}
  @Get(':section')
  state(@Param('identifier') cik: string, @Param('section') section: string) {
    if (!/^\d{10}$/.test(cik))
      throw new BadRequestException('缓存查询请使用10位CIK');
    return this.service.state(cik, kind(section));
  }
  @Post(':section')
  generate() {
    throw new BadRequestException('请使用公司详情页顶部的统一更新入口');
  }
}
@Controller('companies/:cik/updates')
export class CompanyUpdateController {
  constructor(private readonly updates: CompanyUpdateService) {}
  private cik(value: string) {
    if (!/^\d{10}$/.test(value)) throw new BadRequestException('请使用10位CIK');
    return value;
  }
  @Get()
  state(@Param('cik') cik: string) {
    return this.updates.state(this.cik(cik));
  }
  @Post()
  @HttpCode(202)
  start(@Param('cik') cik: string) {
    return this.updates.start(this.cik(cik), 'FULL');
  }
  @Post('initialize')
  @HttpCode(202)
  initialize(@Param('cik') cik: string) {
    return this.updates.start(this.cik(cik), 'INITIAL');
  }
}
@Module({
  imports: [SecModule, PrismaModule, CompanyModule, RevenueModule],
  controllers: [AiResearchController, CompanyUpdateController],
  providers: [AiResearchService, SummaryModel, CompanyUpdateService],
})
export class AiResearchModule {}
