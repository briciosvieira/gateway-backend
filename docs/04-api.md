# API

## Padrão

A API administrativa será documentada com Swagger/OpenAPI.

## URL administrativa

```text
/api/v1
```

## URL pública do Gateway

```text
/gateway
```

## Headers

### Autenticação administrativa

```http
Authorization: Bearer JWT_TOKEN
```

### Autenticação das integrações

```http
X-API-Key: API_KEY
```

O padrão oficial será `X-API-Key`.

## Rotas administrativas iniciais

### Autenticação

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/change-password
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

### Usuários

```text
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id
```

### Clients

```text
POST   /api/v1/clients
GET    /api/v1/clients
GET    /api/v1/clients/:id
PATCH  /api/v1/clients/:id
PATCH  /api/v1/clients/:id/status
```

### API Keys

```text
POST   /api/v1/api-keys
GET    /api/v1/api-keys
GET    /api/v1/api-keys/:id
PATCH  /api/v1/api-keys/:id
PATCH  /api/v1/api-keys/:id/status
POST   /api/v1/api-keys/:id/revoke
POST   /api/v1/api-keys/:id/regenerate
```

### Allowed IPs

```text
POST   /api/v1/allowed-ips
GET    /api/v1/allowed-ips
GET    /api/v1/allowed-ips/:id
PATCH  /api/v1/allowed-ips/:id
PATCH  /api/v1/allowed-ips/:id/status
```

#### Filtros de Allowed IPs

* page
* limit
* search
* clientId
* type
* active
* sortBy
* sortOrder

#### Exemplos

```json
{
  "clientId": "UUID_DO_CLIENTE",
  "address": "192.168.1.10",
  "description": "Servidor externo"
}
```

```json
{
  "clientId": "UUID_DO_CLIENTE",
  "address": "10.0.0.0/24",
  "description": "Rede externa autorizada"
}
```

### Gateway Routes

```text
POST   /api/v1/gateway-routes
GET    /api/v1/gateway-routes
GET    /api/v1/gateway-routes/:id
PATCH  /api/v1/gateway-routes/:id
PATCH  /api/v1/gateway-routes/:id/status
```

#### Filtros de Gateway Routes

* page
* limit
* search
* clientId
* method
* active
* sortBy
* sortOrder

#### Exemplo

```json
{
  "clientId": "UUID_DO_CLIENTE",
  "name": "Envio de WhatsApp",
  "slug": "/send-whatsapp",
  "destinationUrl": "http://n8n.interno.local/webhook/send-whatsapp",
  "method": "POST",
  "description": "Rota para envio de mensagens.",
  "timeoutMs": 30000,
  "retryCount": 0
}
```

Resposta inclui o campo calculado `publicPath` (`/gateway` + slug), não persistido em banco.

### Route Headers

```text
POST   /api/v1/route-headers
GET    /api/v1/route-headers
GET    /api/v1/route-headers/:id
PATCH  /api/v1/route-headers/:id
PATCH  /api/v1/route-headers/:id/status
```

#### Filtros de Route Headers

* page
* limit
* search
* gatewayRouteId
* headerName
* active
* sensitive
* sortBy
* sortOrder

#### Exemplo

```json
{
  "gatewayRouteId": "UUID_DA_ROTA",
  "name": "x-api-key",
  "value": "123456789",
  "sensitive": true
}
```

A resposta nunca inclui o valor criptografado (`valueEncrypted`). O campo `value` retorna `********` quando `sensitive=true`, ou o valor decriptografado quando `sensitive=false`.

### Request Logs

```text
GET /api/v1/request-logs
GET /api/v1/request-logs/by-request-id/:requestId
GET /api/v1/request-logs/:id
```

Somente leitura. `ADMIN`, `OPERATOR` e `AUDITOR` têm acesso; `VIEWER` recebe `403`. Não existe endpoint de escrita.

#### Filtros de Request Logs

* page
* limit
* search
* clientId
* apiKeyId
* gatewayRouteId
* sourceIp
* method
* statusCode
* result (`SUCCESS` ou `ERROR`)
* errorCode
* requestId
* startDate / endDate
* sortBy / sortOrder

A listagem não retorna `requestHeaders`, `requestQuery`, `requestBody` nem `responseHeaders` — esses detalhes aparecem somente na consulta por ID.

### Dashboard

```text
GET /api/v1/dashboard/overview
GET /api/v1/dashboard/requests-over-time
GET /api/v1/dashboard/top-clients
GET /api/v1/dashboard/top-routes
GET /api/v1/dashboard/status-distribution
GET /api/v1/dashboard/top-errors
GET /api/v1/dashboard/top-source-ips
GET /api/v1/dashboard/recent-requests
GET /api/v1/dashboard/health
```

Somente leitura, para todos os perfis (`ADMIN`, `OPERATOR`, `AUDITOR` e `VIEWER`).

#### Filtro de período

Aceito por todos os endpoints acima (exceto `health`):

```text
period    today | last7days | last30days | last90days | custom
startDate obrigatório quando period=custom
endDate   obrigatório quando period=custom
```

`top-clients`, `top-routes`, `top-errors` e `top-source-ips` também aceitam `?limit=` (padrão `10`, máximo `100`).

#### Exemplo

```http
GET /api/v1/dashboard/overview?period=last30days
GET /api/v1/dashboard/top-clients?period=custom&startDate=2026-08-01T00:00:00.000Z&endDate=2026-08-31T23:59:59.999Z&limit=20
```

### Gateway Proxy (endpoint público)

```http
GET    /gateway/*
POST   /gateway/*
PUT    /gateway/*
PATCH  /gateway/*
DELETE /gateway/*
```

Fora do prefixo `/api/v1`. Autenticado exclusivamente por `X-API-Key` — nenhum JWT administrativo é aceito. A resposta (status, body e um conjunto controlado de headers) é devolvida de forma transparente a partir do serviço de destino configurado na Gateway Route.

Ver os códigos de erro padronizados em [Arquitetura](02-architecture.md#tratamento-de-erros-do-gateway-proxy).

### Auditoria

```text
GET /api/v1/audit-logs
GET /api/v1/audit-logs/:id
```

## Exemplo de rota pública

```http
POST /gateway/send-whatsapp
X-API-Key: API_KEY
Content-Type: application/json
```

## Resposta

O Gateway deverá retornar o status HTTP e o corpo recebido do sistema de destino.

Exemplos:

* 200
* 201
* 204
* 400
* 401
* 403
* 404
* 408
* 429
* 500
* 502
* 504
