# Arquitetura

## Visão geral

O Gateway Hub LF será dividido em frontend, backend, banco de dados e infraestrutura de borda.

## Componentes

### Nginx

Responsável por:

* HTTPS
* Certificado SSL
* Proxy reverso
* Limites de requisição
* Regras adicionais por IP
* Encaminhamento para o backend

### Backend

Construído com NestJS utilizando o Fastify Adapter.

Responsável por:

* Autenticação
* Autorização
* API Keys
* Validação de IP
* Gerenciamento de rotas
* Proxy HTTP
* Logs
* Auditoria
* Regras de negócio

### Frontend

Construído com React e Vite.

Responsável por:

* Login
* Dashboard
* Usuários
* Clientes
* API Keys
* Rotas
* Logs
* Auditoria
* Configurações

### Banco de dados

PostgreSQL utilizando Prisma ORM.

## Fluxo da requisição

Implementado pelo `GatewayProxyController`/`GatewayProxyService`, no endpoint público `/gateway/*`:

```text
Cliente externo
      |
      v
Nginx (produção, ainda não implantado)
      |
      v
Gateway Hub LF (/gateway/*)
      |
      +--> Resolve o slug e localiza a GatewayRoute
      +--> Valida rota ativa (404 caso contrário)
      +--> Valida método HTTP (405 caso não corresponda)
      +--> Valida cliente ativo (403 caso contrário)
      +--> Extrai e valida a API Key (401 caso ausente/inválida)
      +--> Obtém o IP real de origem (via trustProxy do Fastify)
      +--> Valida o IP contra os Allowed IPs do cliente (403 caso contrário)
      +--> Carrega e descriptografa os Route Headers ativos
      +--> Monta a URL de destino (query string combinada) e os headers permitidos
      +--> Executa a chamada via undici, com timeout e retry configurados na rota
      +--> Sanitiza os headers de resposta
      +--> Registra um Request Log (sucesso ou falha)
      |
      v
Cliente externo
```

## Estrutura do backend

```text
src/modules/
├── auth/
├── users/
├── roles/
├── clients/
├── api-keys/
├── allowed-ips/
├── gateway-routes/
├── route-headers/
├── gateway-proxy/
├── request-logs/
├── dashboard/
├── audit-logs/
└── health/
```

Todos os módulos do backend planejados até o Dashboard estão implementados. O que falta é o Frontend (ver roadmap).

Infraestrutura compartilhada, fora de `src/modules/`:

```text
src/
├── modules/
├── database/
├── config/
└── common/
```

## Tratamento de erros do Gateway Proxy

Cada etapa do fluxo acima pode interromper a requisição com um código padronizado, sem nunca expor a URL de destino, hostname interno, stack trace ou credenciais:

```text
API Key ausente               → 401 API_KEY_REQUIRED
API Key inválida/revogada     → 401 INVALID_API_KEY
Cliente inativo                → 403 CLIENT_INACTIVE
IP não autorizado              → 403 IP_NOT_ALLOWED
Rota inexistente ou inativa    → 404 GATEWAY_ROUTE_NOT_FOUND
Método não corresponde à rota  → 405 METHOD_NOT_ALLOWED (com header Allow)
Timeout do destino             → 504 UPSTREAM_TIMEOUT
Destino indisponível           → 502 UPSTREAM_UNAVAILABLE
Erro interno do Gateway        → 500 INTERNAL_GATEWAY_ERROR
```

### Capacidades do módulo Allowed IPs

* IPv4 individual
* IPv6 individual
* CIDR IPv4
* CIDR IPv6
* Normalização canônica
* Normalização do endereço real da rede
* Duplicidade controlada por cliente

### Capacidades do módulo Gateway Routes

* Slug público único, normalizado (minúsculo, sempre iniciando com `/`)
* Bloqueio de prefixos administrativos reservados (`/api`, `/auth`, `/users`, `/clients`, `/api-keys`, `/allowed-ips`, `/audit-logs`, `/docs`, `/health`, entre outros)
* URL de destino validada e normalizada (somente `http`/`https`, sem credenciais ou fragmento)
* Métodos HTTP restritos a `GatewayHttpMethod` (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)
* Timeout e número de retries configuráveis, com limites
* `publicPath` (`/gateway` + slug) calculado dinamicamente, não persistido em banco

### Capacidades do módulo Route Headers

* Um header (nome + valor) por registro, vinculado a uma Gateway Route
* Valor sempre criptografado com AES-256-GCM (`HEADER_ENCRYPTION_KEY`, 32 bytes)
* Nome normalizado para HTTP Header-Case; bloqueio de headers de protocolo (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Upgrade`, `Proxy-Authorization`, `Proxy-Authenticate`, `Keep-Alive`, `TE`, `Trailer`, `Expect`)
* Duplicidade bloqueada por rota (`gatewayRouteId` + `name`)
* Marcação `sensitive`: valor sempre mascarado (`********`) nas consultas administrativas, independentemente do perfil
* No Proxy, os valores decriptografados têm precedência sobre headers externos com o mesmo nome, e nunca são persistidos em Request Logs

### Capacidades do módulo Gateway Proxy

* Endpoint público `/gateway/*`, excluído do prefixo `/api/v1` via `app.setGlobalPrefix` com `exclude`
* Autenticação exclusiva por `X-API-Key` (formato `ghlf_<identifier>_<secret>`) e Allowed IP — sem guard JWT
* Comparação do hash da API Key com `timingSafeEqual` (resistente a timing attack)
* Encaminhamento de headers por allow-list (`accept`, `accept-language`, `content-type`, `user-agent`, `x-request-id` e `x-*` customizados, exceto os internos/sensíveis)
* Query string combinada via `URL`/`URLSearchParams`; nunca concatenada manualmente
* Cliente HTTP `undici`, com timeout por `headersTimeout`/`bodyTimeout` e retry com backoff, respeitando `timeoutMs`/`retryCount` da rota
* Nunca segue redirecionamentos (`3xx` é repassado como recebido) — mitigação de SSRF
* Resposta transparente: status, body (Buffer) e headers de resposta por allow-list

### Capacidades do módulo Request Logs

* Registro único por requisição do Proxy, mesmo em falhas anteriores à resolução completa da rota
* `clientId`/`apiKeyId`/`gatewayRouteId` preenchidos apenas até onde a resolução avançou (nulos em etapas anteriores)
* Sanitização recursiva de headers, query string e body (mascaramento por nome de chave, limite de profundidade/itens/tamanho, tratamento de referência circular)
* Corpo armazenado com limite de bytes (`REQUEST_LOG_BODY_MAX_BYTES`) — acima do limite, salva versão truncada preservando o tamanho real estimado
* Leitura por `ADMIN`, `OPERATOR` e `AUDITOR`; `VIEWER` sem acesso; nenhum endpoint de escrita

### Capacidades do módulo Dashboard

* Todas as métricas calculadas via `count()`, `groupBy()` e `aggregate()` do Prisma — sem SQL puro
* Consultas independentes executadas em paralelo com `Promise.all()`
* Série temporal com granularidade automática por período (hora, dia ou semana), calculada em memória a partir dos Request Logs do intervalo
* Filtro de período compartilhado entre todos os endpoints (`today`, `last7days`, `last30days`, `last90days`, `custom`)
* Somente leitura para todos os perfis, incluindo `VIEWER`

## Estrutura do frontend

```text
src/
├── assets/
├── components/
├── layouts/
├── pages/
├── services/
├── hooks/
├── routes/
├── contexts/
├── schemas/
├── types/
└── utils/
```

## Concorrência

O backend trabalhará de forma assíncrona e não bloqueante.

Cada requisição será processada de forma independente, permitindo chamadas simultâneas para clientes e destinos diferentes.

## Comunicação com destinos

O Gateway poderá encaminhar requisições para:

* n8n
* APIs internas
* ERP
* CRM
* Sistemas legados
* Serviços HTTP externos
