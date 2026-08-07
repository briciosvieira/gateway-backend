import 'dotenv/config';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception/http-exception.filter';
import {
  registerContentTypeValidationHook,
  registerMethodWhitelistHook,
  registerResponseHeadersHook,
} from './common/hooks/security-hooks';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import {
  getAllowedOrigins,
  getApplicationVersion,
  getBodyLimit,
  getExposeVersionHeader,
  getHttpsEnabled,
  validateRequiredEnvVars,
} from './config/security.config';
import { BrandingService } from './modules/branding/branding.service';

const ALLOWED_CORS_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
const ALLOWED_CORS_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Request-ID',
  'X-API-Key',
];

async function bootstrap(): Promise<void> {
  validateRequiredEnvVars();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      bodyLimit: getBodyLimit(),
    }),
  );

  const configService = app.get(ConfigService);
  const reflector = app.get(Reflector);
  const fastifyInstance = app.getHttpAdapter().getInstance();

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        scriptSrc: [`'self'`, `'unsafe-inline'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'https://validator.swagger.io'],
        connectSrc: [`'self'`],
      },
    },
    crossOriginEmbedderPolicy: { policy: 'credentialless' },
    // HSTS instructs browsers to only ever use HTTPS for this host — sending
    // it over a plain HTTP development connection would be misleading, so it
    // is only enabled once HTTPS_ENABLED confirms the app is actually served
    // over HTTPS (directly or behind a TLS-terminating proxy).
    ...(getHttpsEnabled() ? {} : { hsts: false }),
  });

  await app.register(fastifyCors, {
    origin: getAllowedOrigins(),
    methods: ALLOWED_CORS_METHODS,
    allowedHeaders: ALLOWED_CORS_HEADERS,
  });

  await app.register(fastifyCompress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
  });

  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fields: 5,
      parts: 6,
      fileSize: 5 * 1024 * 1024,
    },
  });

  registerMethodWhitelistHook(fastifyInstance);
  registerContentTypeValidationHook(fastifyInstance);
  registerResponseHeadersHook(
    fastifyInstance,
    getApplicationVersion(),
    getExposeVersionHeader(),
  );

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'gateway/*path', method: RequestMethod.ALL }],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new ResponseInterceptor(reflector),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // Read once at boot from the same SiteBranding row the admin panel edits —
  // Swagger's document is generated a single time here, so this reflects
  // whatever the application name was when the server last started, not
  // live edits made afterwards (that would require regenerating/re-serving
  // the document per request, which SwaggerModule isn't built for).
  const brandingService = app.get(BrandingService);
  const branding = await brandingService.getPublicBranding();

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${branding.applicationName} API`)
    .setDescription(
      `API administrativa e gateway de integrações do ${branding.applicationName}.`,
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
      },
      'api-key',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3110);
  const host = configService.get<string>('HOST', '0.0.0.0');

  await app.listen({
    port,
    host,
  });

  console.log(
    `${branding.applicationName} running at http://localhost:${port}`,
  );
  console.log(`Swagger available at http://localhost:${port}/docs`);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';

  console.error(`Failed to start Gateway Hub LF: ${message}`);
  process.exit(1);
});
