import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  getStatus() {
    return {
      success: true,
      message: '服务启动成功',
      service: 'company-research',
      endpoints: {
        health: '/api/health',
        companies: '/api/companies',
        financials: '/api/companies/financials',
        favorites: '/api/companies/favorites',
        search: '/api/companies/search?q=GOOG',
        google: '/api/companies/GOOG',
        apple: '/api/companies/AAPL',
      },
    };
  }
}

@Controller()
export class RootController {
  @Get(['', 'api'])
  @Redirect('/api/companies', 302)
  redirectToCompanies() {}
}
