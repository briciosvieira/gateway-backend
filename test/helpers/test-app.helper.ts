import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception/http-exception.filter';
import { RequestIdInterceptor } from '../../src/common/interceptors/request-id.interceptor';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

/**
 * Builds the real Nest application (AppModule, all guards, pipes,
 * interceptors and the exception filter, same as main.ts) against the test
 * database. The rate-limit guard is overridden to always pass — integration
 * and e2e suites issue far more than 100 requests/minute against a single
 * IP, and asserting on business logic should not be flaky because of that.
 * Fastify-level infrastructure registered directly in main.ts (helmet, cors,
 * compress, the method/content-type hooks) is intentionally not replicated
 * here — that layer was already covered by the Security Hardening manual
 * test pass and is orthogonal to the application logic under test.
 */
const neverBlockingThrottlerStorage: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 1,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

export interface TestAppProviderOverride {
  provide: unknown;
  useValue: unknown;
}

/**
 * `overrides` lets a specific suite replace a real provider (e.g. a DNS
 * resolver) with a controllable test double, on top of the throttler
 * override every suite already gets. Existing callers passing no argument
 * are unaffected.
 */
export async function createTestApp(
  overrides: TestAppProviderOverride[] = [],
): Promise<NestFastifyApplication> {
  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(getStorageToken())
    .useValue(neverBlockingThrottlerStorage);

  for (const override of overrides) {
    moduleBuilder = moduleBuilder.overrideProvider(override.provide).useValue(override.useValue);
  }

  const moduleRef: TestingModule = await moduleBuilder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );

  const reflector = app.get(Reflector);

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

  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fields: 5,
      parts: 6,
      fileSize: 5 * 1024 * 1024,
    },
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Gateway Hub LF API')
    .setDescription(
      'API administrativa e gateway de integrações do Gateway Hub LF.',
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

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
