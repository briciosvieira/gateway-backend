# Current Task

## Status

Completed.

## Delivered

- Backend client-aggregated summaries for API Keys, Allowed IPs, and Gateway Routes
- New endpoints:
  - `GET /api/v1/api-keys/clients-summary`
  - `GET /api/v1/allowed-ips/clients-summary`
  - `GET /api/v1/gateway-routes/clients-summary`
- Shared summary query DTO base and feature-specific summary DTOs
- Database-side aggregation, filtering, stable ordering, and pagination
- Swagger/OpenAPI update for the three summary endpoints
- Unit and integration validation for summary counts, filters, ordering, pagination, and no-N+1 behavior
- Request Log `attemptedAt` backfill and `NOT NULL` enforcement
- Request Log creation hardened so new logs always receive `attemptedAt`
- Request Log filtering/ordering aligned to `attemptedAt`
- Backend Trusted CAs management
- PostgreSQL persistence for internal CAs
- Cached Undici dispatcher reconstruction on CA changes
- Gateway Proxy HTTPS trust integration with Node public roots + active internal CAs
- Multipart admin upload
- Audit logging
- OpenAPI update
- Unit, integration, TLS, e2e, and build validation

## Next Task

Frontend — concluir reorganização por cliente de API Keys, Allowed IPs e Gateway Routes usando `clients-summary`
