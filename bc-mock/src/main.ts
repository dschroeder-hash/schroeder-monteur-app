import { buildMockServer } from './server.js';

const port = Number(process.env.PORT ?? 4100);
const { app } = buildMockServer({
  logger: true,
  pageSize: Number(process.env.MOCK_PAGE_SIZE ?? 1000),
  requireAuth: process.env.MOCK_REQUIRE_AUTH !== 'false',
});
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
