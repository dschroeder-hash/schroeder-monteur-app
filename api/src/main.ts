import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApi, createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
if (config.APP_ENV !== 'prod')
  SwaggerModule.setup('docs', app, buildOpenApi(app), { jsonDocumentUrl: 'openapi.json' });
await app.listen(config.PORT, '0.0.0.0');
console.log(
  `Monteur-App API listening on :${config.PORT} (env=${config.APP_ENV}, auth=${config.AUTH_MODE}, bc=${config.BC_MODE})`,
);
