# Implementation Status

## Completed

- Added optional per-route `requiresApiKey` (default `true`) to `GatewayRoute`, migration `20260810143920_add_gateway_route_requires_api_key`
- Reused the existing `GatewayProxyService` decision order (route already resolved before the API Key check) to branch: `requiresApiKey=true` keeps the exact previous behavior; `requiresApiKey=false` skips only the mandatory-key check, still validating a voluntarily sent key
- Added ADMIN-only authorization for setting/changing `requiresApiKey=false` in `GatewayRoutesService` (`create`/`update`), with `403 REQUIRES_API_KEY_ADMIN_ONLY` for non-ADMIN attempts
- Added a dedicated audit log entry ("API Key requirement enabled/disabled") whenever `requiresApiKey` actually changes, in addition to including it in the general CREATE/UPDATE audit payloads
- Added `RequestLog.authenticationMode` (`API_KEY | NONE`), migration in the same file, to distinguish valid unauthenticated calls from invalid ones on protected routes; exposed as an optional filter on `GET /request-logs`
- Added client-aggregated summary endpoints for API Keys, Allowed IPs, and Gateway Routes
- Added shared summary query DTO base plus feature-specific summary DTOs
- Implemented PostgreSQL aggregated summaries with `Prisma.$queryRaw` for:
  - `GET /api/v1/api-keys/clients-summary`
  - `GET /api/v1/allowed-ips/clients-summary`
  - `GET /api/v1/gateway-routes/clients-summary`
- Preserved existing individual list endpoints and CRUD contracts unchanged
- Preserved existing read roles: `ADMIN`, `OPERATOR`, `VIEWER`, `AUDITOR`
- Implemented aggregated status filter semantics:
  - `active` means aggregated active count `> 0`
  - `inactive` means aggregated active count `= 0` with `total > 0`
- Enforced database-side pagination after aggregation, filtering, and sorting
- Enforced stable ordering with `client.id ASC` as the tiebreaker
- Added Swagger/OpenAPI documentation for the three new summary endpoints
- Added unit coverage proving summary services use 2 raw queries instead of per-client queries
- Added integration coverage for counts, filters, stable ordering, pagination, and `/docs-json`
- Added Prisma model `SiteBranding` and migration `20260807170255_add_site_branding`
- Added global branding backend with one installation-wide record in `site_branding`
- Added public branding read endpoints:
  - `GET /api/v1/branding`
  - `GET /api/v1/branding/assets/logo`
  - `GET /api/v1/branding/assets/favicon`
  - `GET /api/v1/branding/assets/brand-image`
- Added `ADMIN` branding management endpoints for name update, asset upload, and asset removal
- Added binary asset persistence in PostgreSQL with MIME type, file name, size, and SHA-256 metadata
- Added safe SVG validation with `fast-xml-parser` plus binary signature validation for PNG/JPEG/WebP/ICO
- Added cacheable public asset serving with `ETag`, `Last-Modified`, immutable cache headers, and versioned URLs
- Added branding audit logging through `AuditEntity.SYSTEM_SETTING` without persisting raw bytes in audit payloads
- Added unit coverage for branding service and branding asset validation
- Added integration coverage for:
  - public unauthenticated branding read
  - `ADMIN` name update
  - non-admin `403`
  - PNG/JPEG/ICO/SVG asset flows
  - malicious SVG rejection
  - asset removal fallback
  - public binary headers
  - `/docs-json`
- Made `RequestLog.attemptedAt` mandatory at the Prisma, database, and TypeScript layers
- Added migration `20260807130613_make_request_log_attempted_at_required`
- Backfilled historical `request_logs.attempted_at` with `created_at` where null
- Removed the `createdAt` fallback from Request Logs date filtering
- Added unit and integration coverage for mandatory `attemptedAt`, date filtering, and chronological ordering
- Added Prisma model `TrustedCa` and migration `20260807043458_add_trusted_cas`
- Expanded `AuditEntity` with `TRUSTED_CA`
- Added Trusted CAs Nest module, controller, service, dispatcher cache, DTOs, interfaces, and X.509 utility
- Registered Fastify multipart in app bootstrap and test bootstrap
- Integrated cached Trusted CA dispatcher into Gateway Proxy HTTPS client
- Preserved Node public roots plus active internal CAs
- Added audit logging for Trusted CA create, activate, deactivate, and delete
- Added Swagger/OpenAPI documentation for Trusted CA endpoints and multipart upload
- Added unit tests for certificate validation, Trusted CAs service, dispatcher cache, and proxy wiring
- Added integration tests for Trusted CAs admin flow and Gateway Proxy TLS trust behavior
- Verified:
  - `npx prisma format`
  - `npx prisma validate`
  - `npx prisma generate`
  - `npx tsc --noEmit`
  - `npm run test`
  - `npm run test:integration`
  - `npm run test:e2e`
  - `npm run build`

## Security Decisions

- `certificatePem` is stored in PostgreSQL because the TLS trust bundle must be rebuilt from persisted records
- `certificatePem` is treated as internal operational data, not as an API payload
- PEM is excluded from API responses, audit logs, and request logs
- TLS validation is never disabled

## Notes

- `requiresApiKey=false` live-verified end-to-end against the local dev database/app: true→401, false→bypasses the key check while Allowed IP/Client/Route checks kept blocking as expected, false→reaches the upstream stage, then back to true→401 again
- `.ai/PROJECT_CONTEXT.md` and `.ai/BACKEND_CONTRACTS.md` were not present at task start
- Trusted CAs admin is complete on backend
- Frontend for certificate management remains pending by design
- Frontend reorganization by client for API Keys, Allowed IPs, and Gateway Routes remains pending by design
- Frontend for branding/personalization remains pending by design
- Request Logs now always use UTC `attemptedAt` as the primary chronological timestamp
- Client resource summaries use raw SQL because Prisma's higher-level aggregation APIs were not sufficient for combined JOIN + conditional aggregate + grouped pagination + stable sort requirements
- The client summary delivery did not require a migration because the required `client_id` indexes already existed
- Branding required a new migration because binary asset storage and metadata do not fit the existing `SystemSetting` key/value shape cleanly
- Test database was migrated with `20260807170255_add_site_branding` before running the full integration suite
