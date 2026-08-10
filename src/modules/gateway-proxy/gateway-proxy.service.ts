import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { errors as undiciErrors, request as undiciRequest } from 'undici';
import type { Dispatcher } from 'undici';
import {
  RequestLogAuthenticationMode,
  RequestLogResult,
  RequestOrigin,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { hashApiKey } from '../api-keys/utils/api-key.util';
import type { CreateRequestLogInput } from '../request-logs/interfaces/create-request-log.interface';
import { RequestLogsService } from '../request-logs/request-logs.service';
import { estimatePayloadSize } from '../request-logs/utils/request-size.util';
import {
  decryptHeaderValue,
  parseHeaderEncryptionKey,
} from '../route-headers/utils/route-header-encryption.util';
import type { GatewayErrorCode, GatewayErrorResult } from './interfaces/gateway-error.interface';
import { isGatewayErrorResult } from './interfaces/gateway-error.interface';
import type {
  ResolvedApiKey,
  ResolvedGatewayRoute,
  ResolvedRouteHeader,
} from './interfaces/resolved-gateway-request.interface';
import type { ProxyResult } from './interfaces/proxy-result.interface';
import { TrustedCaDispatcherService } from '../trusted-cas/trusted-ca-dispatcher.service';
import { sourceIpMatchesAllowedIp } from './utils/allowed-ip-matcher.util';
import { parseApiKey } from './utils/api-key-parser.util';
import { buildForwardHeaders, sanitizeResponseHeaders } from './utils/forwarded-headers.util';
import { normalizeSourceIp } from './utils/source-ip.util';

const GATEWAY_PATH_PREFIX = '/gateway';
const RETRYABLE_UPSTREAM_STATUS_CODES = new Set([502, 503, 504]);
const DESTINATION_IP_CACHE_TTL_MS = 30_000;
const MASKED_QUERY_VALUE = '********';
const SENSITIVE_QUERY_PARAM_NAMES = [
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'client_secret',
  'cookie',
  'password',
  'refresh_token',
  'secret',
  'signature',
  'token',
  'valueencrypted',
  'x-api-key',
];

interface UpstreamResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

interface UpstreamOutcome {
  response?: UpstreamResponse;
  timedOut: boolean;
  attempts: number;
}

interface RequestLogResolution {
  clientId: string | null;
  apiKeyId: string | null;
  gatewayRouteId: string | null;
  destinationHost: string | null;
  destinationUrl: string | null;
  destinationIp: string | null;
  authenticationMode: RequestLogAuthenticationMode;
}

interface GatewayRequestBase {
  requestId: string;
  method: string;
  publicSlug: string;
  requestPath: string;
  sourceIp: string;
  sourceHost: string | null;
  requestOrigin: RequestOrigin;
  publicEndpoint: string | null;
  attemptedAt: Date;
}

const gatewayRouteSelect = {
  id: true,
  slug: true,
  method: true,
  destinationUrl: true,
  timeoutMs: true,
  retryCount: true,
  active: true,
  requiresApiKey: true,
  clientId: true,
} as const;

@Injectable()
export class GatewayProxyService {
  private readonly logger = new Logger(GatewayProxyService.name);
  private readonly destinationIpCache = new Map<
    string,
    { address: string | null; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly requestLogsService: RequestLogsService,
    private readonly trustedCaDispatcherService: TrustedCaDispatcherService,
  ) {}

  async handleGatewayRequest(request: FastifyRequest): Promise<ProxyResult | GatewayErrorResult> {
    const attemptedAt = new Date();
    const startedAt = Date.now();
    const incomingUrl = new URL(request.url, 'http://internal.local');
    const sourceHost = this.resolveSourceHost(request);
    const requestPath = incomingUrl.pathname;

    const base: GatewayRequestBase = {
      requestId: this.resolveRequestId(request),
      method: request.method.toUpperCase(),
      publicSlug: this.resolvePublicSlug(incomingUrl),
      requestPath,
      sourceIp: this.resolveSourceIp(request),
      sourceHost,
      requestOrigin: this.resolveRequestOrigin(sourceHost),
      publicEndpoint: this.buildPublicEndpoint(request, requestPath, sourceHost),
      attemptedAt,
    };

    const resolution: RequestLogResolution = {
      clientId: null,
      apiKeyId: null,
      gatewayRouteId: null,
      destinationHost: null,
      destinationUrl: null,
      destinationIp: null,
      authenticationMode: RequestLogAuthenticationMode.API_KEY,
    };

    const result = await this.resolveAndForward(request, incomingUrl, base, resolution);

    const durationMs = Date.now() - startedAt;

    if (!isGatewayErrorResult(result)) {
      result.durationMs = durationMs;
    }

    await this.recordRequestLog(request, incomingUrl, base, resolution, result, durationMs);

    return result;
  }

  private async resolveAndForward(
    request: FastifyRequest,
    incomingUrl: URL,
    base: GatewayRequestBase,
    resolution: RequestLogResolution,
  ): Promise<ProxyResult | GatewayErrorResult> {
    const { requestId, method, publicSlug, sourceIp } = base;

    const route = await this.findRoute(publicSlug);

    if (!route || !route.active) {
      return this.sendGatewayError(
        'GATEWAY_ROUTE_NOT_FOUND',
        404,
        'The requested gateway route was not found.',
      );
    }

    resolution.gatewayRouteId = route.id;
    resolution.clientId = route.clientId;
    resolution.authenticationMode = route.requiresApiKey
      ? RequestLogAuthenticationMode.API_KEY
      : RequestLogAuthenticationMode.NONE;

    if (route.method !== method) {
      return this.sendGatewayError(
        'METHOD_NOT_ALLOWED',
        405,
        'This HTTP method is not allowed for this route.',
        route.method,
      );
    }

    const clientIsActive = await this.validateClient(route.clientId);

    if (!clientIsActive) {
      return this.sendGatewayError(
        'CLIENT_INACTIVE',
        403,
        'This client is not authorized to use this route.',
      );
    }

    const rawApiKey = this.extractApiKey(request);

    if (route.requiresApiKey) {
      if (!rawApiKey) {
        return this.sendGatewayError('API_KEY_REQUIRED', 401, 'API Key was not provided.');
      }

      const apiKey = await this.validateApiKey(rawApiKey, route.clientId, resolution);

      if (!apiKey) {
        return this.sendGatewayError(
          'INVALID_API_KEY',
          401,
          'API Key is invalid, expired or revoked.',
        );
      }
    } else if (rawApiKey) {
      // requiresApiKey=false does not make the header mandatory, but a caller who still sends
      // one is asserting a credential — validating it (instead of silently ignoring it) avoids
      // masking an invalid/revoked key as if it had been accepted.
      const apiKey = await this.validateApiKey(rawApiKey, route.clientId, resolution);

      if (!apiKey) {
        return this.sendGatewayError(
          'INVALID_API_KEY',
          401,
          'API Key is invalid, expired or revoked.',
        );
      }
    }

    const isIpAllowed = await this.validateAllowedIp(sourceIp, route.clientId);

    if (!isIpAllowed) {
      return this.sendGatewayError('IP_NOT_ALLOWED', 403, 'The source IP is not authorized.');
    }

    let routeHeaders: ResolvedRouteHeader[];

    try {
      routeHeaders = await this.loadRouteHeaders(route.id);
    } catch (error) {
      this.logger.error(
        'Failed to load or decrypt route headers.',
        error instanceof Error ? error.stack : undefined,
      );

      return this.sendGatewayError(
        'INTERNAL_GATEWAY_ERROR',
        500,
        'An internal error occurred while processing the request.',
      );
    }

    const destinationUrl = this.buildDestinationUrl(route.destinationUrl, incomingUrl.searchParams);
    const destinationHost = this.extractDestinationHost(destinationUrl);
    const destinationIpPromise = this.resolveDestinationIp(destinationHost);

    resolution.destinationHost = destinationHost;
    resolution.destinationUrl = this.sanitizeOperationalUrl(destinationUrl);

    const forwardHeaders = this.buildForwardHeaders(
      request.headers,
      routeHeaders,
      requestId,
      sourceIp,
    );

    const contentType =
      typeof request.headers['content-type'] === 'string'
        ? request.headers['content-type']
        : undefined;
    const requestBody = this.buildRequestBody(method, request.body, contentType);

    const upstreamOutcome = await this.executeUpstreamRequestWithRetry(
      destinationUrl,
      method,
      forwardHeaders,
      requestBody,
      route.timeoutMs,
      route.retryCount,
    );

    resolution.destinationIp = await destinationIpPromise;

    if (!upstreamOutcome.response) {
      if (upstreamOutcome.timedOut) {
        return this.sendGatewayError(
          'UPSTREAM_TIMEOUT',
          504,
          'The upstream service did not respond in time.',
          undefined,
          upstreamOutcome.attempts,
        );
      }

      return this.sendGatewayError(
        'UPSTREAM_UNAVAILABLE',
        502,
        'The upstream service is unavailable.',
        undefined,
        upstreamOutcome.attempts,
      );
    }

    return {
      statusCode: upstreamOutcome.response.statusCode,
      headers: this.sanitizeResponseHeaders(upstreamOutcome.response.headers, requestId),
      body: upstreamOutcome.response.body,
      durationMs: 0,
      attempts: upstreamOutcome.attempts,
    };
  }

  private async recordRequestLog(
    request: FastifyRequest,
    incomingUrl: URL,
    base: GatewayRequestBase,
    resolution: RequestLogResolution,
    result: ProxyResult | GatewayErrorResult,
    durationMs: number,
  ): Promise<void> {
    const isError = isGatewayErrorResult(result);

    const input = {
      requestId: base.requestId,
      attemptedAt: base.attemptedAt,
      requestOrigin: base.requestOrigin,
      sourceHost: base.sourceHost,
      clientId: resolution.clientId,
      apiKeyId: resolution.apiKeyId,
      gatewayRouteId: resolution.gatewayRouteId,
      authenticationMode: resolution.authenticationMode,
      sourceIp: base.sourceIp,
      publicEndpoint: base.publicEndpoint,
      destinationHost: resolution.destinationHost,
      destinationUrl: resolution.destinationUrl,
      destinationIp: resolution.destinationIp,
      upstreamStatusCode: isError ? null : result.statusCode,
      method: base.method,
      publicPath: base.requestPath,
      statusCode: result.statusCode,
      durationMs,
      attempts: isError ? (result.attempts ?? 0) : result.attempts,
      result: result.statusCode < 400 ? RequestLogResult.SUCCESS : RequestLogResult.ERROR,
      errorCode: isError ? result.code : null,
      errorMessage: isError ? result.message : null,
      requestHeaders: request.headers,
      requestQuery: Object.fromEntries(incomingUrl.searchParams),
      requestBody: request.body,
      requestSizeBytes: estimatePayloadSize(request.body),
      responseHeaders: isError ? undefined : result.headers,
      responseBody: isError ? undefined : this.parseResponseBodyForLog(result.body, result.headers),
      responseSizeBytes: isError ? null : result.body.length,
    } as CreateRequestLogInput;

    await this.requestLogsService.create(input);
  }

  private resolveRequestId(request: FastifyRequest): string {
    const value = request.headers['x-request-id'];

    return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  }

  private resolvePublicSlug(incomingUrl: URL): string {
    const pathWithoutQuery = incomingUrl.pathname;

    const publicSlug = pathWithoutQuery.startsWith(GATEWAY_PATH_PREFIX)
      ? pathWithoutQuery.slice(GATEWAY_PATH_PREFIX.length)
      : pathWithoutQuery;

    const normalizedSlug = publicSlug.length > 0 ? publicSlug : '/';

    return normalizedSlug.length > 1 && normalizedSlug.endsWith('/')
      ? normalizedSlug.slice(0, -1)
      : normalizedSlug;
  }

  private async findRoute(publicSlug: string): Promise<ResolvedGatewayRoute | null> {
    return this.prisma.gatewayRoute.findUnique({
      where: {
        slug: publicSlug,
      },
      select: gatewayRouteSelect,
    });
  }

  private async validateClient(clientId: string): Promise<boolean> {
    const client = await this.prisma.client.findUnique({
      where: {
        id: clientId,
      },
      select: {
        active: true,
      },
    });

    return client?.active ?? false;
  }

  private extractApiKey(request: FastifyRequest): string | null {
    const value = request.headers['x-api-key'];

    if (typeof value !== 'string') {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue.length > 0 ? trimmedValue : null;
  }

  private async validateApiKey(
    rawApiKey: string,
    routeClientId: string,
    resolution: RequestLogResolution,
  ): Promise<ResolvedApiKey | null> {
    const parsedApiKey = parseApiKey(rawApiKey);

    if (!parsedApiKey) {
      return null;
    }

    const apiKeyRecord = await this.prisma.apiKey.findUnique({
      where: {
        prefix: parsedApiKey.prefix,
      },
      select: {
        id: true,
        clientId: true,
        keyHash: true,
        active: true,
        revokedAt: true,
        expiresAt: true,
        client: {
          select: {
            active: true,
          },
        },
      },
    });

    if (!apiKeyRecord) {
      return null;
    }

    // The record exists — safe to keep internally for forensics even if it turns out to be
    // invalid below. This is never exposed in the public response (GatewayErrorResult has no
    // apiKeyId field), only stored in the RequestLog for internal audit purposes.
    resolution.apiKeyId = apiKeyRecord.id;

    const pepper = this.getPepperOrThrow();
    const computedHash = hashApiKey(parsedApiKey.fullKey, pepper);
    const hashMatches = this.timingSafeCompareHashes(computedHash, apiKeyRecord.keyHash);

    const isValid =
      hashMatches &&
      apiKeyRecord.active &&
      apiKeyRecord.revokedAt === null &&
      (apiKeyRecord.expiresAt === null || apiKeyRecord.expiresAt > new Date()) &&
      apiKeyRecord.client.active &&
      apiKeyRecord.clientId === routeClientId;

    if (!isValid) {
      return null;
    }

    this.touchLastUsedAt(apiKeyRecord.id);

    return {
      id: apiKeyRecord.id,
      clientId: apiKeyRecord.clientId,
    };
  }

  private touchLastUsedAt(apiKeyId: string): void {
    this.prisma.apiKey
      .update({
        where: {
          id: apiKeyId,
        },
        data: {
          lastUsedAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to update lastUsedAt for API Key ${apiKeyId}.`,
          error instanceof Error ? error.stack : undefined,
        );
      });
  }

  private timingSafeCompareHashes(computedHash: string, storedHash: string): boolean {
    const computedBuffer = Buffer.from(computedHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');

    if (computedBuffer.length !== storedBuffer.length) {
      return false;
    }

    return timingSafeEqual(computedBuffer, storedBuffer);
  }

  private resolveSourceIp(request: FastifyRequest): string {
    return normalizeSourceIp(request.ip);
  }

  private resolveSourceHost(request: FastifyRequest): string | null {
    const requestHost =
      typeof request.host === 'string' && request.host.trim()
        ? request.host.trim()
        : typeof request.headers.host === 'string' && request.headers.host.trim()
          ? request.headers.host.trim()
          : null;

    return requestHost;
  }

  private resolveRequestOrigin(sourceHost: string | null): RequestOrigin {
    if (!sourceHost) {
      return RequestOrigin.PUBLIC;
    }

    const hostname = this.extractHostname(sourceHost);

    if (!hostname) {
      return RequestOrigin.PUBLIC;
    }

    const normalizedHostname = hostname.toLowerCase();

    if (
      normalizedHostname === 'localhost' ||
      normalizedHostname === '::1' ||
      normalizedHostname === '[::1]' ||
      normalizedHostname === '127.0.0.1' ||
      normalizedHostname.endsWith('.localhost') ||
      normalizedHostname.includes('.intranet.') ||
      normalizedHostname.includes('.internal.') ||
      normalizedHostname.endsWith('.intranet') ||
      normalizedHostname.endsWith('.internal')
    ) {
      return RequestOrigin.INTERNAL;
    }

    return RequestOrigin.PUBLIC;
  }

  private buildPublicEndpoint(
    request: FastifyRequest,
    requestPath: string,
    sourceHost: string | null,
  ): string | null {
    if (!sourceHost) {
      return null;
    }

    const protocol =
      typeof request.protocol === 'string' && request.protocol.trim()
        ? request.protocol.trim()
        : 'http';

    return `${protocol}://${sourceHost}${requestPath}`;
  }

  private async validateAllowedIp(sourceIp: string, clientId: string): Promise<boolean> {
    const allowedIps = await this.prisma.allowedIp.findMany({
      where: {
        clientId,
        active: true,
      },
      select: {
        address: true,
        type: true,
      },
    });

    if (allowedIps.length === 0) {
      return false;
    }

    return allowedIps.some((allowedIp) => sourceIpMatchesAllowedIp(sourceIp, allowedIp));
  }

  private async loadRouteHeaders(gatewayRouteId: string): Promise<ResolvedRouteHeader[]> {
    const headers = await this.prisma.routeHeader.findMany({
      where: {
        gatewayRouteId,
        active: true,
      },
      select: {
        name: true,
        valueEncrypted: true,
      },
    });

    const encryptionKey = this.getEncryptionKeyOrThrow();

    return headers.map((header) => ({
      name: header.name,
      value: decryptHeaderValue(header.valueEncrypted, encryptionKey),
    }));
  }

  private buildDestinationUrl(destinationUrl: string, incomingSearchParams: URLSearchParams): string {
    const targetUrl = new URL(destinationUrl);

    for (const [key, value] of incomingSearchParams) {
      targetUrl.searchParams.append(key, value);
    }

    return targetUrl.toString();
  }

  private extractDestinationHost(destinationUrl: string): string | null {
    try {
      return new URL(destinationUrl).hostname;
    } catch {
      return null;
    }
  }

  private sanitizeOperationalUrl(destinationUrl: string): string | null {
    try {
      const parsedUrl = new URL(destinationUrl);

      parsedUrl.username = '';
      parsedUrl.password = '';

      for (const key of Array.from(parsedUrl.searchParams.keys())) {
        if (this.isSensitiveQueryParam(key)) {
          parsedUrl.searchParams.set(key, MASKED_QUERY_VALUE);
        }
      }

      return parsedUrl.toString();
    } catch {
      return null;
    }
  }

  private async resolveDestinationIp(destinationHost: string | null): Promise<string | null> {
    if (!destinationHost) {
      return null;
    }

    if (isIP(destinationHost)) {
      return normalizeSourceIp(destinationHost);
    }

    const now = Date.now();
    const cachedEntry = this.destinationIpCache.get(destinationHost);

    if (cachedEntry && cachedEntry.expiresAt > now) {
      return cachedEntry.address;
    }

    // Undici's high-level request API does not expose the remote socket address in this flow.
    // To avoid a fresh DNS lookup on every request, the resolved address is cached briefly.
    try {
      const resolved = await dnsLookup(destinationHost);
      const normalizedAddress = normalizeSourceIp(resolved.address);

      this.destinationIpCache.set(destinationHost, {
        address: normalizedAddress,
        expiresAt: now + DESTINATION_IP_CACHE_TTL_MS,
      });

      return normalizedAddress;
    } catch (error) {
      this.destinationIpCache.set(destinationHost, {
        address: null,
        expiresAt: now + DESTINATION_IP_CACHE_TTL_MS,
      });

      this.logger.debug(
        `Failed to resolve destination IP for host ${destinationHost}.`,
        error instanceof Error ? error.message : undefined,
      );

      return null;
    }
  }

  private buildForwardHeaders(
    incomingHeaders: Record<string, string | string[] | undefined>,
    routeHeaders: ResolvedRouteHeader[],
    requestId: string,
    sourceIp: string,
  ): Record<string, string> {
    return buildForwardHeaders(incomingHeaders, routeHeaders, requestId, sourceIp);
  }

  private buildRequestBody(
    method: string,
    body: unknown,
    contentType: string | undefined,
  ): string | Buffer | undefined {
    if (method === 'GET' || body === undefined) {
      return undefined;
    }

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (typeof body === 'string') {
      return body;
    }

    if (
      contentType?.includes('application/x-www-form-urlencoded') &&
      typeof body === 'object' &&
      body !== null
    ) {
      const encodedBody = new URLSearchParams();

      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        encodedBody.append(key, String(value));
      }

      return encodedBody.toString();
    }

    return JSON.stringify(body);
  }

  private async executeUpstreamRequestWithRetry(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | Buffer | undefined,
    timeoutMs: number,
    retryCount: number,
  ): Promise<UpstreamOutcome> {
    // NOTE: retries are applied uniformly per the route's configured retryCount, as instructed.
    // For non-idempotent methods (e.g. POST), a retry after a connection failure or timeout may
    // cause the upstream operation to be executed more than once. This is a known, accepted risk
    // since retryCount is an explicit administrator decision made in the Gateway Routes module.
    const maxAttempts = retryCount + 1;
    let attempts = 0;
    let timedOut = false;

    while (attempts < maxAttempts) {
      attempts += 1;

      try {
        const response = await this.executeUpstreamRequest(url, method, headers, body, timeoutMs);

        const isRetryableStatus = RETRYABLE_UPSTREAM_STATUS_CODES.has(response.statusCode);

        if (isRetryableStatus && attempts < maxAttempts) {
          await this.delay(this.computeBackoffMs(attempts));
          continue;
        }

        return { response, timedOut: false, attempts };
      } catch (error) {
        timedOut =
          error instanceof undiciErrors.HeadersTimeoutError ||
          error instanceof undiciErrors.BodyTimeoutError ||
          error instanceof undiciErrors.ConnectTimeoutError;

        if (attempts < maxAttempts) {
          await this.delay(this.computeBackoffMs(attempts));
          continue;
        }

        if (this.isTlsValidationError(error)) {
          this.logger.warn(
            `TLS validation failed for upstream host ${this.extractDestinationHost(url) ?? 'unknown'}.`,
          );
        } else {
          this.logger.error(
            `Upstream request to ${url} failed after ${attempts} attempt(s).`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    return { timedOut, attempts };
  }

  private async executeUpstreamRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | Buffer | undefined,
    timeoutMs: number,
  ): Promise<UpstreamResponse> {
    const dispatcher = await this.trustedCaDispatcherService.getDispatcher();

    // No redirect interceptor is attached to the default dispatcher, so undici's plain
    // `request()` never follows redirects automatically — the upstream's 3xx response is
    // returned to the caller as-is, satisfying the "do not follow redirects" requirement.
    const response = await undiciRequest(url, {
      method: method as Dispatcher.HttpMethod,
      dispatcher,
      headers,
      body,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });

    const responseBodyBuffer = Buffer.from(await response.body.arrayBuffer());

    const responseHeaders: Record<string, string | string[]> = {};

    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        responseHeaders[name] = value;
      }
    }

    return {
      statusCode: response.statusCode,
      headers: responseHeaders,
      body: responseBodyBuffer,
    };
  }

  private computeBackoffMs(attempt: number): number {
    return Math.min(100 * attempt, 1000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private sanitizeResponseHeaders(
    upstreamHeaders: Record<string, string | string[] | undefined>,
    requestId: string,
  ): Record<string, string | string[]> {
    return sanitizeResponseHeaders(upstreamHeaders, requestId);
  }

  private parseResponseBodyForLog(
    body: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): unknown {
    if (body.length === 0) {
      return null;
    }

    const contentTypeHeader = headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    const normalizedContentType = contentType?.toLowerCase() ?? '';

    if (normalizedContentType.includes('application/json')) {
      try {
        return JSON.parse(body.toString('utf8')) as unknown;
      } catch {
        return body.toString('utf8');
      }
    }

    if (
      normalizedContentType.startsWith('text/') ||
      normalizedContentType.includes('application/xml') ||
      normalizedContentType.includes('application/javascript') ||
      normalizedContentType.includes('application/x-www-form-urlencoded')
    ) {
      return body.toString('utf8');
    }

    return `[binary ${body.length} bytes]`;
  }

  private sendGatewayError(
    code: GatewayErrorCode,
    statusCode: number,
    message: string,
    allowedMethods?: string,
    attempts?: number,
  ): GatewayErrorResult {
    return { code, statusCode, message, allowedMethods, attempts };
  }

  private getPepperOrThrow(): string {
    const pepper = this.configService.get<string>('API_KEY_PEPPER');

    if (!pepper) {
      throw new Error('API_KEY_PEPPER is not configured.');
    }

    return pepper;
  }

  private getEncryptionKeyOrThrow(): Buffer {
    const hexKey = this.configService.get<string>('HEADER_ENCRYPTION_KEY');

    if (!hexKey) {
      throw new Error('HEADER_ENCRYPTION_KEY is not configured.');
    }

    return parseHeaderEncryptionKey(hexKey);
  }

  private extractHostname(host: string): string | null {
    try {
      return new URL(`http://${host}`).hostname;
    } catch {
      return null;
    }
  }

  private isSensitiveQueryParam(key: string): boolean {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');

    return SENSITIVE_QUERY_PARAM_NAMES.some(
      (sensitiveKey) => normalizedKey === sensitiveKey.replace(/[_-]/g, ''),
    );
  }

  private isTlsValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const tlsErrorCodes = new Set([
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ]);

    const errorCode =
      'code' in error && typeof error.code === 'string' ? error.code : null;

    return errorCode !== null && tlsErrorCodes.has(errorCode);
  }
}
