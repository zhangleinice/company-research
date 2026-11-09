import { AiResearchModule } from './modules/ai-research/ai-research.module';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { AppController, RootController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { CompanyModule } from './modules/company/company.module';

@Module({
  controllers: [AppController, RootController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'),
    }),
    CompanyModule,
    AiResearchModule,
  ],
})
export class AppModule {}
