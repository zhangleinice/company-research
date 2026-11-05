import { INestApplication, RequestMethod } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'api', method: RequestMethod.GET },
    ],
  });
}
