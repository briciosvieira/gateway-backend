# Current Task

## Status

Completed.

## Delivered

- Backend-only: optional per-Gateway-Route `requiresApiKey` (default `true`), ADMIN-only to set `false`
- `GatewayRoute.requiresApiKey Boolean @default(true)`, migration `20260810143920_add_gateway_route_requires_api_key`
- `RequestLog.authenticationMode` (`API_KEY | NONE`) added in the same migration to distinguish valid unauthenticated calls from invalid ones on protected routes
- `GatewayProxyService` branches the API Key check on `route.requiresApiKey` (route was already resolved before that check, no reordering needed); every other validation (Client active, Route active, Allowed IP, Route Headers, TLS, upstream, logging) is unchanged
- A voluntarily sent X-API-Key on a `requiresApiKey=false` route is still validated (invalid key is rejected, not ignored)
- `CreateGatewayRouteDto`/`UpdateGatewayRouteDto` expose `requiresApiKey?: boolean`; non-ADMIN attempts to set/change it to `false` get `403 REQUIRES_API_KEY_ADMIN_ONLY`
- Dedicated audit log entry on every actual `requiresApiKey` change, in addition to the general CREATE/UPDATE audit payloads
- `GET /request-logs` accepts an optional `authenticationMode` filter
- Unit + integration tests added/passing; `prisma validate`/`generate`, `tsc`, `build` all clean; live-verified against the local dev app

## Next Task

Frontend — Configuracoes > Personalizacao

- adicionar item `Personalizacao` abaixo de `Certificados`
- editar `applicationName`
- subir/remover logo
- subir/remover favicon
- subir/remover brand image
- aplicar branding dinamico em Sidebar, Home, Login, browser title e favicon
- manter fallback visual atual quando URLs de branding forem `null`

Frontend — Gateway Routes: configuração de `requiresApiKey`

- expor toggle `requiresApiKey` no formulário de criação/edição de Gateway Route (somente ADMIN pode desmarcar)
- exibir alerta visual quando uma rota estiver com `requiresApiKey=false` (rota sem exigência de API Key)
