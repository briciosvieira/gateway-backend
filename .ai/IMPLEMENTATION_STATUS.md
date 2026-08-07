# Implementation Status

## Completed

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

- `.ai/PROJECT_CONTEXT.md` and `.ai/BACKEND_CONTRACTS.md` were not present at task start
- Trusted CAs admin is complete on backend
- Frontend for certificate management remains pending by design
- Frontend reorganization by client for API Keys, Allowed IPs, and Gateway Routes remains pending by design
- Request Logs now always use UTC `attemptedAt` as the primary chronological timestamp
- Client resource summaries use raw SQL because Prisma's higher-level aggregation APIs were not sufficient for combined JOIN + conditional aggregate + grouped pagination + stable sort requirements
- No new migration was needed because the required `client_id` indexes already existed
