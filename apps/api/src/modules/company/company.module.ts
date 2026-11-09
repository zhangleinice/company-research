import { Module } from '@nestjs/common';
import { SecModule } from '../sec/sec.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialService } from '../financials/financial.service';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [SecModule, PrismaModule],
  controllers: [CompanyController],
  providers: [CompanyService, FinancialService],
  exports: [CompanyService],
})
export class CompanyModule {}
