import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CompanyService } from './company.service';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companies: CompanyService) {}

  @Get('search')
  search(@Query('q', new DefaultValuePipe('')) query: string) {
    return this.companies.search(query);
  }

  @Get('favorites')
  favorites(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('q', new DefaultValuePipe('')) query: string,
    @Query('mode', new DefaultValuePipe('annual')) mode: string,
  ) {
    return this.companies.getCompanies(page, limit, query, mode, true);
  }

  @Get(['', 'financials'])
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('q', new DefaultValuePipe('')) query: string,
    @Query('mode', new DefaultValuePipe('annual')) mode: string,
  ) {
    return this.companies.getCompanies(page, limit, query, mode);
  }

  @Patch(':identifier/favorite')
  favorite(@Param('identifier') identifier: string, @Body() body: unknown) {
    if (typeof body !== 'object' || body === null || !('isFavorite' in body))
      throw new BadRequestException('isFavorite is required');
    return this.companies.setFavorite(identifier, body.isFavorite);
  }

  @Get(':identifier/annual')
  async annual(@Param('identifier') identifier: string) {
    return (await this.companies.getCompany(identifier)).annual;
  }

  @Get(':identifier/quarterly')
  async quarterly(@Param('identifier') identifier: string) {
    return (await this.companies.getCompany(identifier)).quarterly;
  }

  @Get(':identifier')
  detail(@Param('identifier') identifier: string) {
    return this.companies.getCompany(identifier);
  }
}
