import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { Test as SupertestTest } from 'supertest';

export function authorizedGet(
  app: NestFastifyApplication,
  url: string,
  token: string,
): SupertestTest {
  return request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`);
}

export function authorizedPost(
  app: NestFastifyApplication,
  url: string,
  token: string,
  body?: object,
): SupertestTest {
  const req = request(app.getHttpServer())
    .post(url)
    .set('Authorization', `Bearer ${token}`);

  return body === undefined ? req : req.send(body);
}

export function authorizedPatch(
  app: NestFastifyApplication,
  url: string,
  token: string,
  body?: object,
): SupertestTest {
  const req = request(app.getHttpServer())
    .patch(url)
    .set('Authorization', `Bearer ${token}`);

  return body === undefined ? req : req.send(body);
}

export function authorizedDelete(
  app: NestFastifyApplication,
  url: string,
  token: string,
): SupertestTest {
  return request(app.getHttpServer())
    .delete(url)
    .set('Authorization', `Bearer ${token}`);
}
