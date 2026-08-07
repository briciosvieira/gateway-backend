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
