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

## Gateway Routes — Per-route security matrix (`requiresApiKey` x `requiresAllowedIp`)

- Prisma fields: `GatewayRoute.requiresApiKey Boolean @default(true)`, `GatewayRoute.requiresAllowedIp Boolean @default(true)`
- Migrations: `20260810143920_add_gateway_route_requires_api_key` (also adds `RequestLog.authenticationMode`), `20260915115758_add_gateway_route_requires_allowed_ip`
- Both additive, both default `true` — no existing route was changed to `false`/unrestricted by either migration
- The two flags are fully independent per route:
  - `requiresApiKey=true, requiresAllowedIp=true` → both a valid X-API-Key and an authorized source (IP/CIDR/HOSTNAME) are required
  - `requiresApiKey=true, requiresAllowedIp=false` → X-API-Key required, any source IP accepted
  - `requiresApiKey=false, requiresAllowedIp=true` → no X-API-Key required, source must still match an Allowed IP entry
  - `requiresApiKey=false, requiresAllowedIp=false` → neither check applies
- Every other validation always runs regardless of either flag: Gateway Route resolution and `active` status, Client `active` status, Route Headers, TLS / trusted CA validation, timeout / retry / upstream forwarding, Request Logs / Audit Logs
- There is no global switch for either flag — both are exclusively per Gateway Route (never per client)

### Gateway Proxy decision order (`GatewayProxyService.resolveAndForward`)

1. Resolve Gateway Route by slug, require `active`
2. Validate HTTP method
3. Validate Client `active`
4. Read `route.requiresApiKey`:
   - `true` → X-API-Key is mandatory; missing → `401 API_KEY_REQUIRED`; invalid/expired/revoked/wrong client → `401 INVALID_API_KEY`
   - `false` → X-API-Key is not required; if the header is absent, continue; **if the header is present anyway, it is still validated** (invalid → `401 INVALID_API_KEY`) — a voluntarily sent key is never silently ignored
5. Read `route.requiresAllowedIp`:
   - `true` → `validateAllowedIp()` runs exactly as before (same `sourceIpMatchesAllowedIp` matcher and `AllowedHostnameResolverService`, not duplicated); no match → `403 IP_NOT_ALLOWED`
   - `false` → the Allowed IP check (and the `prisma.allowedIp.findMany` query) is skipped entirely — any source IP is accepted at this step
6. Route Headers (always applied)
7. Upstream request (always attempted)
8. Request Log persisted (always)

### Permissions (`GatewayRoutesService`)

- `POST /gateway-routes`: OPERATOR/ADMIN can create; `requiresApiKey: false` is ADMIN-only — non-ADMIN gets `403 { code: 'REQUIRES_API_KEY_ADMIN_ONLY' }`, defaults silently to `true` otherwise
- `PATCH /gateway-routes/:id`: any *change* to `requiresApiKey` (in either direction) is ADMIN-only — same `403 REQUIRES_API_KEY_ADMIN_ONLY`. Sending the field with its current value, or omitting it entirely, does not require ADMIN and never side-effects the flag
- `requiresAllowedIp` has **no permission gate** — any role that can create/update a route (ADMIN/OPERATOR) can set or change it to any value, no confirmation step. This is a deliberate scope decision (not requested by the task that introduced it) since the matrix behavior it implements never mentioned a role distinction; if a stricter gate is ever wanted, mirror the `requiresApiKey` ADMIN-only pattern
- Both DTOs (`CreateGatewayRouteDto`, `UpdateGatewayRouteDto`) expose `requiresApiKey?: boolean` and `requiresAllowedIp?: boolean` via Swagger

### Audit

- The general `CREATE`/`UPDATE`/`DELETE` audit entries for a Gateway Route always include both `requiresApiKey` and `requiresAllowedIp` in their `newValue`/`previousValue`
- Additionally, whenever an `UPDATE` actually changes `requiresApiKey`, a **dedicated** `AuditAction.UPDATE` / `AuditEntity.GATEWAY_ROUTE` entry is recorded with `description` = `"Gateway Route API Key requirement enabled/disabled for route <slug>."`, and `previousValue`/`newValue` containing `gatewayRouteId`, `clientId`, `name`, `slug`, `requiresApiKey`
- `requiresAllowedIp` does **not** get this same dedicated second audit entry (consistent with it having no permission gate) — its change is only visible in the standard UPDATE audit payload

### Request Logs — `authenticationMode`

- New enum `RequestLogAuthenticationMode { API_KEY, NONE }`, field `RequestLog.authenticationMode`, `@default(API_KEY)`, `NOT NULL`, indexed
- Set from the resolved route's `requiresApiKey` as soon as the route is known (`API_KEY` when `true`, `NONE` when `false`); defaults to `API_KEY` for requests that never resolve a route (e.g. `GATEWAY_ROUTE_NOT_FOUND`), matching the pre-existing (always-required) behavior
- Distinguishes a valid unauthenticated call (`requiresApiKey=false`, `apiKeyId=null`, `authenticationMode=NONE`, `result=SUCCESS`) from an invalid one on a protected route (`requiresApiKey=true`, `apiKeyId=null`, `authenticationMode=API_KEY`, `errorCode=API_KEY_REQUIRED`)
- `authenticationMode` reflects the route's policy, not whether a key happened to be sent — a voluntary, valid key on a `requiresApiKey=false` route still logs `authenticationMode=NONE` (with `apiKeyId` populated)
- `GET /request-logs` accepts an optional `authenticationMode` filter

## Allowed IPs — HOSTNAME (forward-DNS) support

- `AllowedIpType` gained a fifth value: `HOSTNAME` (alongside `IPV4`, `IPV6`, `CIDR_IPV4`, `CIDR_IPV6`)
- Migration: `20260813125514_add_allowed_ip_hostname_type` (additive `ALTER TYPE ... ADD VALUE`, no data change)
- `address` still holds the raw value; for `HOSTNAME` it is the bare hostname (trim + lowercase), e.g. `api.cliente.com.br`
- `parseAllowedIpAddress` (`src/modules/allowed-ips/utils/ip-address.util.ts`) tries CIDR, then plain IP, then falls back to `parseAllowedHostname` (`utils/hostname-address.util.ts`) — IP/CIDR parsing and error paths are otherwise unchanged
- Hostname validation rejects: protocol (`http://`/`https://`), path, port, query string, whitespace, wildcards (`*`), consecutive/leading/trailing dots, single-label values (no dot), and a purely-numeric top-level label (heuristic for a malformed IP typed as if it were a hostname)
- `CreateAllowedIpDto`/`UpdateAllowedIpDto.address` max length raised from 100 to 253 (RFC hostname limit); IP/CIDR behavior unchanged

### Endpoints

- No new endpoints — `/allowed-ips` (create/list/get/update/status/delete) and `/allowed-ips/clients-summary` are unchanged; `HOSTNAME` is just another `type` value returned/filterable like the others
- `GET /allowed-ips?type=HOSTNAME` works automatically since the DTO's `type` filter already binds to the Prisma enum
- Summaries count a `HOSTNAME` row exactly like any other Allowed IP (`active=true` → counts as active); DNS resolution health is never factored into the summary's active/inactive counters

### DNS resolution — `AllowedHostnameResolverService`

- New, isolated service: `src/modules/allowed-ips/allowed-hostname-resolver.service.ts`, provided/exported by `AllowedIpsModule`; `GatewayProxyModule` imports `AllowedIpsModule` to consume it (no circular dependency introduced)
- Forward DNS only (`node:dns/promises` `resolve4`/`resolve6`, run in parallel, per-lookup 4s timeout) — **never** reverse DNS on the request's source IP, and never derived from the `Host` header or any client-supplied hostname
- All A + AAAA records are combined (DNS round-robin / multi-record hostnames fully supported); results are deduplicated
- Resolved addresses are filtered to public/unicast only (`ipaddr.parse(ip).range() === 'unicast'`) — loopback, RFC1918/RFC4193, link-local, multicast, unspecified, and other reserved ranges (including RFC5737 documentation ranges) are dropped. **This restriction applies only to `HOSTNAME` entries** — direct IP/CIDR entries are completely unaffected and may still be internal/private as before
- In-memory cache keyed by hostname (global, not per-client — two clients registering the same hostname share one cache entry/DNS cost, which is safe since the resolved IP set doesn't depend on which client registered it)
- TTL: default 30 minutes, overridable via `ALLOWED_HOSTNAME_DNS_TTL_MINUTES` (valid range 5–1440; out-of-range or missing falls back to the 30-minute default) — same config pattern as `REQUEST_LOG_BODY_MAX_BYTES` in `RequestLogsService`
- Concurrent resolution requests for the same hostname are deduplicated via an in-flight-promise map — 100 simultaneous requests against an expired hostname trigger exactly one DNS lookup
- **Fail closed, no stale-if-error window (explicit product decision for this first version)**: if a hostname has never resolved successfully, or its cache has expired and the refresh attempt fails, `resolve()` returns `null` and that entry contributes zero matches — it never falls back to a previously-cached (now-expired) list. A `null` result from one `HOSTNAME` entry does not affect any other Allowed IP entry for the same client (IP/CIDR entries, or other hostnames, are still evaluated independently)
- Cache invalidation (`invalidate(hostname)`): called by `AllowedIpsService` when a `HOSTNAME` entry's address changes (old hostname invalidated), is deactivated (invalidated; reactivation resolves on demand — no eager re-resolve), or is deleted. Creating a new hostname, or reactivating one, never needs invalidation
- Observability: logs `Allowed hostname resolved. hostname=<x> addressesCount=<n>` on success and a warning with the failure reason on failure — no per-request logging, no cache contents in Audit Log

### Gateway Proxy matching (`GatewayProxyService.validateAllowedIp`)

- Unchanged for `IPV4`/`IPV6`/`CIDR_IPV4`/`CIDR_IPV6` — still handled by `sourceIpMatchesAllowedIp` exactly as before
- For `HOSTNAME`, the source IP is compared against `AllowedHostnameResolverService.resolve(address)`'s result (`resolvedAddresses.includes(sourceIp)`); a `null` result means no match from that entry, not a block of the whole request — other entries can still grant access
- `sourceIp` resolution itself (trusted proxy / `x-forwarded-for` handling) is completely untouched

### Audit

- Unchanged — `HOSTNAME` create/update/status-change/delete go through the exact same `AuditLogsService.create()` calls as IP/CIDR entries; no new audit action, no DNS-cache content ever written to an audit log, no audit entry generated by automatic background DNS refreshes (there are none — resolution only happens lazily on a Gateway Proxy request)

### Known trade-off reported, not implemented

- A hostname that legitimately needs to resolve to an internal/private IP (e.g. an internal-only client hostname) is **not supported** — such a hostname will resolve to zero usable addresses and the entry will fail closed (blocking, never silently allowing). If a real use case needs this, it requires a deliberate follow-up decision (e.g. a per-entry opt-out flag), not a default relaxation of the public-only filter

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
