# Current Task

## Status

Completed.

## Delivered

- Per-route security matrix: `GatewayRoute.requiresAllowedIp` (default `true`), independent from `requiresApiKey`, on both backend and frontend (gateway-hub-lf-frontend)
- `GatewayRoute.requiresAllowedIp Boolean @default(true)`, migration `20260915115758_add_gateway_route_requires_allowed_ip`
- `GatewayProxyService` skips `validateAllowedIp()` entirely when `route.requiresAllowedIp === false`; the existing IP/CIDR/HOSTNAME matcher and `AllowedHostnameResolverService` are reused unchanged — no new matcher, no logic moved to the client level
- Unlike `requiresApiKey`, `requiresAllowedIp` has **no ADMIN-only gate** — any role that can create/update a route (ADMIN/OPERATOR) can set it, no confirmation dialog on the frontend (explicit scope decision, not requested by the task; documented in BACKEND_CONTRACTS.md)
- `CreateGatewayRouteDto`/`UpdateGatewayRouteDto` expose `requiresAllowedIp?: boolean`; included in the general CREATE/UPDATE/DELETE audit payloads (no dedicated audit event, unlike `requiresApiKey`)
- Frontend: "Autenticação da rota" section renamed to "Segurança da rota" (`gatewayRoutes.form.authenticationTitle`), new checkbox + hint text reusing the same form components as `requiresApiKey`; new `AllowedIpRequirementBadge` (table) and a matching detail row (drawer), both mirroring the existing `ApiKeyRequirementBadge` pattern — shown only for the exception case (`requiresAllowedIp === false`)
- Backend: unit + integration tests added for the 4 requiresApiKey×requiresAllowedIp combinations plus regressions (IP/CIDR/HOSTNAME matching untouched, migration default preserves existing routes); `prisma validate`/`generate`, `tsc`, `build` all clean
- Backend-only: Allowed IP supports a third category, `HOSTNAME`, resolved via forward DNS (A/AAAA) into the set of IPs treated as allowed, on top of the untouched IP/CIDR behavior
- `AllowedIpType.HOSTNAME` added, migration `20260813125514_add_allowed_ip_hostname_type`
- New `AllowedHostnameResolverService`: resolve4/resolve6, public-address-only filter (rejects loopback/RFC1918/link-local/multicast/reserved/documentation ranges), 30-minute default TTL (`ALLOWED_HOSTNAME_DNS_TTL_MINUTES` env override, 5–1440 range), in-flight dedup per hostname, fail-closed (no stale-if-error) on DNS failure
- `GatewayProxyService.validateAllowedIp` matches `HOSTNAME` entries against the resolver's cached addresses; `sourceIp` resolution itself is untouched, and this is strictly forward DNS — never reverse DNS on the request's source IP
- `AllowedIpsService` invalidates the per-hostname cache on address change, deactivation, and deletion
- `/allowed-ips` endpoints (create/list/get/update/status/delete/clients-summary) are structurally unchanged — `HOSTNAME` is just another `type` value; summaries are unaffected by DNS resolution health
- Same permissions as IP/CIDR (no new ADMIN-only restriction for hostnames)
- Unit + integration tests added/passing (122 unit + 48+ integration); `prisma validate`/`generate`, `tsc`, `build` all clean; live-verified against real DNS (`one.one.one.one`) on the local dev app, including cache reuse
- Known trade-off, reported not silently worked around: a hostname needing to resolve to an internal/private IP is not supported in this version (would need an explicit follow-up decision)

## Next Task

Frontend — Configuracoes > Personalizacao

- adicionar item `Personalizacao` abaixo de `Certificados`
- editar `applicationName`
- subir/remover logo
- subir/remover favicon
- subir/remover brand image
- aplicar branding dinamico em Sidebar, Home, Login, browser title e favicon
- manter fallback visual atual quando URLs de branding forem `null`

Frontend — Gateway Routes: configuração de `requiresApiKey` e `requiresAllowedIp`

- concluído: ambos os toggles existem no formulário de criação/edição, com badges na tabela e na drawer de detalhes (ver `gateway-hub-lf-frontend`)

Frontend — Allowed IP com seleção IP/CIDR/DNS

- adicionar seletor de tipo (IP, CIDR, DNS/Hostname) no formulário de criação/edição de Allowed IP
- exibir o `type` retornado (incluindo `HOSTNAME`) na listagem/detalhe
- explicar ao usuário que hostname é resolvido via DNS e os IPs resultantes é que são comparados contra a origem real
