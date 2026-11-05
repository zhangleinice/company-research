import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const apiRequire = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const webRequire = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
);
const { Test } = apiRequire('@nestjs/testing');
const { AppModule } = apiRequire('./dist/app.module.js');
const { configureApp } = apiRequire('./dist/setup.js');
const { SecClient } = apiRequire('./dist/modules/sec/sec.client.js');
const { PrismaService } = apiRequire('./dist/modules/prisma/prisma.service.js');
const { createServer } = await import(webRequire.resolve('vite'));
test('Vite forwards the ten-row directory query without acquiring company financials', async (t) => {
  const requests = [];
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SecClient)
    .useValue({
      getJson: async (url) => {
        requests.push(url);
        assert.ok(url.includes('company_tickers'));
        return {
          0: { ticker: 'GOOG', cik_str: 1652044, title: 'Proxy test fixture' },
        };
      },
    })
    .overrideProvider(PrismaService)
    .useValue({ company: { findMany: async () => [] } })
    .compile();
  const app = module.createNestApplication();
  t.after(() => app.close());
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const apiPort = app.getHttpServer().address().port;
  const vite = await createServer({
    root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
  });
  t.after(() => vite.close());
  await vite.listen();
  const port = vite.httpServer.address().port;
  const response = await fetch(
    `http://127.0.0.1:${port}/api/companies?page=1&limit=10&q=GOOG&mode=annual`,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.limit, 10);
  assert.equal(result.total, 1);
  assert.equal(result.data[0].financial, null);
  assert.equal(result.data[0].financialStatus, 'NOT_FETCHED');
  assert.equal(requests.length, 1);
});
