import {
  BadRequestException,
  Controller,
  Get,
  Module,
  Query,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MergersService } from './mergers.service';
@Controller('mergers')
export class MergersController {
  constructor(private readonly mergers: MergersService) {}
  @Get()
  list(@Query('page') page = '1', @Query('limit') limit = '10') {
    const p = Number(page),
      l = Number(limit);
    if (
      !Number.isSafeInteger(p) ||
      p < 1 ||
      p > 1000000 ||
      !Number.isSafeInteger(l) ||
      l < 1 ||
      l > 100
    )
      throw new BadRequestException('分页参数无效');
    return this.mergers.list(p, l);
  }
}
@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [MergersController],
  providers: [MergersService],
})
export class MergersModule {}
