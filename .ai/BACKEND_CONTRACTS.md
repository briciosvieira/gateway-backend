# Backend Contracts

## Trusted CAs

- Prisma model: `TrustedCa`
- Persistence: PostgreSQL table `trusted_cas`
- Storage: `certificatePem` persisted as internal text field, never exposed by the API
- Roles: every administrative endpoint is `ADMIN` only
- Multipart contract:
  - `POST /api/v1/trusted-cas`
  - content type: `multipart/form-data`
  - fields:
    - `name`
    - `file`

## Endpoints

- `GET /api/v1/trusted-cas`
- `GET /api/v1/trusted-cas/:id`
- `POST /api/v1/trusted-cas`
- `PATCH /api/v1/trusted-cas/:id/status`
- `DELETE /api/v1/trusted-cas/:id`

## Response Metadata

- `id`
- `name`
- `fingerprintSha256`
- `subject`
- `issuer`
- `serialNumber`
- `validFrom`
- `validTo`
- `isRoot`
- `active`
- `createdById`
- `createdAt`
- `updatedAt`

`certificatePem` is not part of any public response schema and is not returned by list/detail/create/status endpoints.

## Validation Rules

- Accepted extensions: `.pem`, `.crt`, `.cer`
- Rejected extensions: `.key`, `.pfx`, `.p12`
- Private key markers rejected immediately:
  - `-----BEGIN PRIVATE KEY-----`
  - `-----BEGIN RSA PRIVATE KEY-----`
  - `-----BEGIN EC PRIVATE KEY-----`
  - `-----BEGIN ENCRYPTED PRIVATE KEY-----`
- Exactly one PEM certificate per upload
- X.509 parsing uses Node `X509Certificate`
- Only CA certificates are accepted
- Expired certificates are rejected on create
- Fingerprint uniqueness enforced by `fingerprintSha256`
- Duplicate create returns `409` with code `TRUSTED_CA_ALREADY_EXISTS`

## Error Codes

- `INVALID_MULTIPART_REQUEST`
- `INVALID_TRUSTED_CA_UPLOAD`
- `INVALID_TRUSTED_CA_NAME`
- `FILE_TOO_LARGE`
- `INVALID_CERTIFICATE`
- `CERTIFICATE_NOT_CA`
- `CERTIFICATE_EXPIRED`
- `PRIVATE_KEY_NOT_ALLOWED`
- `UNSUPPORTED_CERTIFICATE_FORMAT`
- `TRUSTED_CA_ALREADY_EXISTS`

## TLS / Gateway Proxy

- `rejectUnauthorized: true` remains enabled
- Hostname verification remains enabled
- Active internal CAs are combined with Node public roots via `rootCertificates`
- If no active internal CAs exist, the proxy keeps using only the standard Node public roots
- The proxy reuses a cached Undici `Agent`
- Cache invalidation occurs on `CREATE`, `ACTIVATE`, `DEACTIVATE`, and `DELETE`
- Expired internal CAs are ignored when building the trust bundle
- No PEM download endpoint exists
- No endpoint returns raw PEM

## Gateway Routes — Optional API Key requirement

- Prisma field: `GatewayRoute.requiresApiKey Boolean @default(true)`
- Migration: `20260810143920_add_gateway_route_requires_api_key` (additive, backfills existing rows to `true`; also adds `RequestLog.authenticationMode`)
- Default is always `true`; no existing route was changed to `false` by the migration
- `requiresApiKey=false` only skips the X-API-Key requirement — every other validation still runs unchanged:
  - Gateway Route resolution and `active` status
  - Client `active` status
  - Allowed IP
  - Route Headers
  - TLS / trusted CA validation
  - timeout / retry / upstream forwarding
  - Request Logs / Audit Logs
- There is no global switch — the flag is exclusively per Gateway Route

### Gateway Proxy decision order (`GatewayProxyService.resolveAndForward`)

1. Resolve Gateway Route by slug, require `active`
2. Validate HTTP method
3. Validate Client `active`
4. Read `route.requiresApiKey`:
   - `true` → X-API-Key is mandatory; missing → `401 API_KEY_REQUIRED`; invalid/expired/revoked/wrong client → `401 INVALID_API_KEY`
   - `false` → X-API-Key is not required; if the header is absent, continue; **if the header is present anyway, it is still validated** (invalid → `401 INVALID_API_KEY`) — a voluntarily sent key is never silently ignored
5. Allowed IP (always enforced)
6. Route Headers (always applied)
7. Upstream request (always attempted)
8. Request Log persisted (always)

### Permissions (`GatewayRoutesService`)

- `POST /gateway-routes`: OPERATOR/ADMIN can create; `requiresApiKey: false` is ADMIN-only — non-ADMIN gets `403 { code: 'REQUIRES_API_KEY_ADMIN_ONLY' }`, defaults silently to `true` otherwise
- `PATCH /gateway-routes/:id`: any *change* to `requiresApiKey` (in either direction) is ADMIN-only — same `403 REQUIRES_API_KEY_ADMIN_ONLY`. Sending the field with its current value, or omitting it entirely, does not require ADMIN and never side-effects the flag
- Both DTOs (`CreateGatewayRouteDto`, `UpdateGatewayRouteDto`) expose `requiresApiKey?: boolean` via Swagger

### Audit

- The general `CREATE`/`UPDATE` audit entries for a Gateway Route always include `requiresApiKey` in their `newValue`/`previousValue`
- Additionally, whenever an `UPDATE` actually changes `requiresApiKey`, a **dedicated** `AuditAction.UPDATE` / `AuditEntity.GATEWAY_ROUTE` entry is recorded with `description` = `"Gateway Route API Key requirement enabled/disabled for route <slug>."`, and `previousValue`/`newValue` containing `gatewayRouteId`, `clientId`, `name`, `slug`, `requiresApiKey`

### Request Logs — `authenticationMode`

- New enum `RequestLogAuthenticationMode { API_KEY, NONE }`, field `RequestLog.authenticationMode`, `@default(API_KEY)`, `NOT NULL`, indexed
- Set from the resolved route's `requiresApiKey` as soon as the route is known (`API_KEY` when `true`, `NONE` when `false`); defaults to `API_KEY` for requests that never resolve a route (e.g. `GATEWAY_ROUTE_NOT_FOUND`), matching the pre-existing (always-required) behavior
- Distinguishes a valid unauthenticated call (`requiresApiKey=false`, `apiKeyId=null`, `authenticationMode=NONE`, `result=SUCCESS`) from an invalid one on a protected route (`requiresApiKey=true`, `apiKeyId=null`, `authenticationMode=API_KEY`, `errorCode=API_KEY_REQUIRED`)
- `authenticationMode` reflects the route's policy, not whether a key happened to be sent — a voluntary, valid key on a `requiresApiKey=false` route still logs `authenticationMode=NONE` (with `apiKeyId` populated)
- `GET /request-logs` accepts an optional `authenticationMode` filter

## Request Logs

- `RequestLog.attemptedAt` is required and persisted as UTC
- New request logs can no longer be created with `attemptedAt = null`
- `attemptedAt` is captured at the beginning of the gateway request
- `createdAt` remains the persistence timestamp
- Historical rows were backfilled with `attemptedAt = createdAt` before the column became `NOT NULL`
- Date filters (`startDate`, `endDate`) operate on `attemptedAt`
- Default ordering remains `attemptedAt DESC`

## Client Resource Summaries

### Endpoints

- `GET /api/v1/api-keys/clients-summary`
- `GET /api/v1/allowed-ips/clients-summary`
- `GET /api/v1/gateway-routes/clients-summary`

Existing individual list endpoints remain unchanged and still support `clientId`:

- `GET /api/v1/api-keys?clientId=<uuid>`
- `GET /api/v1/allowed-ips?clientId=<uuid>`
- `GET /api/v1/gateway-routes?clientId=<uuid>`

### Roles

- `ADMIN`
- `OPERATOR`
- `VIEWER`
- `AUDITOR`

The new summary endpoints use the same read permissions already applied to the existing list endpoints in those three controllers.

### Query Params

Shared params:

- `page` default `1`
- `limit` default `20`, max `100`
- `search?` searches `client.name` and `client.code` with PostgreSQL `ILIKE`
- `status?` in `active | inactive`
- `sortOrder` in `asc | desc`, default `asc`

`GET /api/v1/api-keys/clients-summary`

- `sortBy` in `clientName | total | active | inactive | revoked`
- default `sortBy=clientName`

`GET /api/v1/allowed-ips/clients-summary`

- `sortBy` in `clientName | total | active | inactive`
- default `sortBy=clientName`

`GET /api/v1/gateway-routes/clients-summary`

- `sortBy` in `clientName | total | active | inactive`
- default `sortBy=clientName`

### Response Shape

Common envelope remains the existing application wrapper:

- `success`
- `message`
- `data`
- `requestId`
- `timestamp`

Shared `data` shape:

- `items`
- `pagination`
- `filters`

Shared `client` payload per item:

- `id`
- `name`
- `code`
- `active`

`GET /api/v1/api-keys/clients-summary` item:

- `client`
- `total`
- `active`
- `inactive`
- `revoked`

`GET /api/v1/allowed-ips/clients-summary` item:

- `client`
- `total`
- `active`
- `inactive`

`GET /api/v1/gateway-routes/clients-summary` item:

- `client`
- `total`
- `active`
- `inactive`

### Aggregation Rules

Shared status filter rule:

- `status=active` means aggregated `active > 0`
- `status=inactive` means aggregated `total > 0 AND active = 0`
- clients with `total = 0` never appear
- `pagination.total` counts matching clients, never individual resources

API Keys:

- `total` = all API Keys of the client
- `revoked` = `revoked_at IS NOT NULL`
- `active` = `active = true AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
- `inactive` = non-revoked keys that are not counted as active
- invariant: `total = active + inactive + revoked`

Allowed IPs:

- `total` = all Allowed IPs of the client
- `active` = `active = true`
- `inactive` = `active = false`
- invariant: `total = active + inactive`

Gateway Routes:

- `total` = all Gateway Routes of the client
- `active` = `active = true`
- `inactive` = `active = false`
- invariant: `total = active + inactive`

### SQL / Performance

- Implementation uses `Prisma.$queryRaw` with PostgreSQL aggregation
- each summary request executes exactly 2 queries:
  - 1 paginated aggregated data query
  - 1 aggregated count query for `pagination.total`
- no `N+1`
- no in-memory regrouping
- no frontend-side counting
- pagination happens after aggregation/filtering/sorting in the database
- `ORDER BY` is built only from an internal whitelist
- stable ordering always uses `client.id ASC` as the tiebreaker

### Indexes

Existing relevant indexes already used:

- `api_keys_client_id_idx`
- `allowed_ips_client_id_idx`
- `gateway_routes_client_id_idx`
- `api_keys_active_idx`
- `api_keys_expires_at_idx`
- `api_keys_revoked_at_idx`
- `allowed_ips_active_idx`
- `gateway_routes_active_idx`

No new index or structural migration was required for this delivery.

## Branding

- Prisma model: `SiteBranding`
- Persistence: PostgreSQL table `site_branding`
- Scope: exactly 1 global branding row for the whole installation
- Default row id: `site-branding`
- Default behavior without custom row:
  - `applicationName = Gateway Hub LF`
  - `logoUrl = null`
  - `faviconUrl = null`
  - `brandImageUrl = null`
- Frontend fallback remains static when asset URLs are `null`

### Data Model

- `applicationName`
- `logoData`
- `logoMimeType`
- `logoFileName`
- `logoSizeBytes`
- `logoSha256`
- `faviconData`
- `faviconMimeType`
- `faviconFileName`
- `faviconSizeBytes`
- `faviconSha256`
- `brandImageData`
- `brandImageMimeType`
- `brandImageFileName`
- `brandImageSizeBytes`
- `brandImageSha256`
- `createdById`
- `updatedById`
- `createdAt`
- `updatedAt`

### Storage Strategy

- Branding assets are stored in PostgreSQL `Bytes`
- No asset is stored as base64 text in JSON or `Text`
- Metadata stored per asset:
  - MIME type
  - sanitized file name
  - size in bytes
  - SHA-256 fingerprint
- File bytes are never returned inside JSON responses

### Public Endpoints

- `GET /api/v1/branding`
- `GET /api/v1/branding/assets/logo`
- `GET /api/v1/branding/assets/favicon`
- `GET /api/v1/branding/assets/brand-image`

`GET /api/v1/branding` is public and returns only:

- `applicationName`
- `logoUrl`
- `faviconUrl`
- `brandImageUrl`
- `updatedAt`

### Administrative Endpoints

- `PATCH /api/v1/branding`
- `POST /api/v1/branding/logo`
- `POST /api/v1/branding/favicon`
- `POST /api/v1/branding/brand-image`
- `DELETE /api/v1/branding/logo`
- `DELETE /api/v1/branding/favicon`
- `DELETE /api/v1/branding/brand-image`

### Roles

- Public read: no authentication required
- Write / upload / delete: `ADMIN` only

### Update Contract

`PATCH /api/v1/branding`

- body:
  - `applicationName: string`
- validation:
  - required when sent
  - trim applied
  - min length `2`
  - max length `100`
  - blank values rejected
  - `<` and `>` rejected

### Multipart Contract

Each asset uses `multipart/form-data` with one field:

- `file`

Per endpoint:

- `POST /api/v1/branding/logo`
- `POST /api/v1/branding/favicon`
- `POST /api/v1/branding/brand-image`

### Accepted Formats

Logo:

- `image/png`
- `image/jpeg`
- `image/jpg`
- `image/webp`
- `image/svg+xml`

Favicon:

- `image/png`
- `image/jpeg`
- `image/jpg`
- `image/webp`
- `image/svg+xml`
- `image/x-icon`
- `image/vnd.microsoft.icon`

Brand image:

- `image/png`
- `image/jpeg`
- `image/jpg`
- `image/webp`
- `image/svg+xml`

### Limits

- logo: `2 MB`
- favicon: `512 KB`
- brand image: `5 MB`

### File Validation

- file cannot be empty
- extension is not trusted
- MIME type is checked
- magic bytes / binary signature are checked for:
  - PNG
  - JPEG
  - WebP
  - ICO
- SVG is parsed and validated as XML
- uploaded file names are sanitized with basename extraction only
- arbitrary files such as HTML, JS, PDF, ZIP, executables are rejected

### SVG Security Strategy

- uses `fast-xml-parser`
- XML must be valid
- `<!DOCTYPE>` and `<!ENTITY>` are rejected
- root node must be `<svg>`
- only a whitelist of safe tags is accepted
- dangerous tags are rejected, including:
  - `script`
  - `foreignObject`
  - `iframe`
  - `object`
  - `embed`
  - `audio`
  - `video`
  - `image`
  - `a`
  - animation tags
  - `use`
  - `style`
- event handler attributes are rejected
- `href`, `xlink:href`, `src`, `style` are rejected
- values containing `javascript:`, `data:`, `vbscript:`, or `url(` are rejected

### Asset Serving / Cache

- assets are served as binary responses
- correct `Content-Type` is returned
- `Content-Length` is returned
- `ETag` is returned from SHA-256
- `Last-Modified` is returned from `updatedAt`
- `Cache-Control: public, max-age=31536000, immutable`
- asset URLs are versioned with `?v=<sha256>`
- conditional requests with `If-None-Match` and `If-Modified-Since` return `304`

### Replacement / Reset Semantics

- a new upload of the same asset replaces the previous one
- no asset history is kept
- deleting an asset removes only that asset metadata and bytes
- deleting an asset does not delete the branding row
- after delete:
  - public asset URL becomes `null`
  - direct binary endpoint returns `404`

### Audit

- audit entity: `SYSTEM_SETTING`
- audit row `entityId`: `site-branding`
- audited changes:
  - application name update
  - logo upload / replace / remove
  - favicon upload / replace / remove
  - brand image upload / replace / remove
- asset bytes are never written to audit logs
- audit stores only safe metadata:
  - asset type
  - MIME type
  - file name
  - size
  - SHA-256
  - request id
  - source IP

### Error Codes

- `INVALID_BRANDING_APPLICATION_NAME`
- `INVALID_MULTIPART_REQUEST`
- `INVALID_BRANDING_UPLOAD`
- `INVALID_BRANDING_ASSET`
- `UNSUPPORTED_BRANDING_ASSET_TYPE`
- `INVALID_BRANDING_ASSET_MIME_TYPE`
- `UNSAFE_SVG_NOT_ALLOWED`
- `FILE_TOO_LARGE`
