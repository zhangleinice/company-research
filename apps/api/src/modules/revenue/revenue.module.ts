import {
  BadRequestException,
  Controller,
  Get,
  Module,
  Param,
} from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecModule } from '../sec/sec.module';
import { RevenueService } from './revenue.service';
@Controller('companies/:cik/revenue-breakdown')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}
  @Get() get(@Param('cik') cik: string) {
    if (!/^\d{10}$/.test(cik)) throw new BadRequestException('请使用10位CIK');
    return this.revenue.ensure(cik);
  }
}
@Module({
  imports: [PrismaModule, SecModule],
  controllers: [RevenueController],
  providers: [RevenueService],
  exports: [RevenueService],
})
export class RevenueModule {}
