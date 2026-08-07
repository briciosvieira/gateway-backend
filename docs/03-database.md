# Banco de Dados

## Tecnologia

* PostgreSQL
* Prisma ORM
* Migrations versionadas

## Banco recomendado

```text
gateway_hub_lf
```

## Usuário recomendado

```text
gateway_hub_lf_user
```

O usuário deverá possuir acesso somente ao banco da aplicação.

## Entidades principais

### users

* id
* name
* username
* email
* password_hash
* role_id
* active
* first_login
* last_login_at
* created_at
* updated_at

### roles

* id
* name
* description
* created_at
* updated_at

Perfis iniciais:

* ADMIN
* OPERATOR
* VIEWER
* AUDITOR

### clients (model `Client`)

* id
* name
* code
* description
* contact_name
* contact_email
* active
* created_at
* updated_at

### api_keys (model `ApiKey`)

* id
* client_id
* name
* prefix
* key_hash
* active
* expires_at
* last_used_at
* revoked_at
* created_at
* updated_at

### gateway_routes (model `GatewayRoute`)

* id
* client_id
* name
* slug
* description
* destination_url
* method
* timeout_ms
* retry_count
* active
* created_at
* updated_at

#### Enum `GatewayHttpMethod`

* GET
* POST
* PUT
* PATCH
* DELETE

### route_headers (model `RouteHeader`)

* id
* gateway_route_id
* name
* value_encrypted
* sensitive
* active
* created_at
* updated_at

O valor (`value_encrypted`) é sempre um texto cifrado com AES-256-GCM (IV, tag de autenticação e texto cifrado, todos em base64, concatenados por `:`). Nunca é armazenado em texto puro.

### allowed_ips (model `AllowedIp`)

* id
* client_id
* address
* type
* description
* active
* created_at
* updated_at

#### Enum `AllowedIpType`

* IPV4
* IPV6
* CIDR_IPV4
* CIDR_IPV6

### request_logs (model `RequestLog`)

* id
* request_id (único)
* client_id (nulo se a resolução falhar antes de identificar o cliente)
* api_key_id (nulo se a API Key não existir; preenchido internamente mesmo quando inválida, nunca exposto publicamente)
* gateway_route_id (nulo se a rota não existir/estiver inativa)
* source_ip
* method
* public_path
* status_code
* duration_ms
* attempts
* result (`SUCCESS` ou `ERROR`)
* error_code (nulo em respostas reais do destino; preenchido apenas em erros do próprio Gateway)
* error_message
* request_headers (sanitizado, somente em sucesso)
* request_query (sanitizado, somente em sucesso)
* request_body (sanitizado e truncado por `REQUEST_LOG_BODY_MAX_BYTES`, somente em sucesso)
* response_headers (sanitizado, somente em sucesso)
* request_size_bytes
* response_size_bytes
* created_at

Não possui `destination_url`: a URL interna nunca é persistida. Não possui relacionamento com usuário administrativo — a criação é exclusiva do Gateway Proxy.

#### Enum `RequestLogResult`

* SUCCESS
* ERROR

### audit_logs

* id
* user_id
* action
* entity
* entity_id
* previous_value
* new_value
* source_ip
* created_at

## Regras

* API Keys não serão armazenadas em texto puro.
* Senhas serão armazenadas com hash.
* Campos sensíveis dos logs poderão ser mascarados.
* Logs antigos poderão possuir política de retenção.
* Índices serão criados para rotas, clientes, API Keys, status e datas.
* O endereço de um Allowed IP é normalizado antes de ser salvo.
* Redes CIDR são salvas com o endereço real da rede.
* O mesmo endereço não pode ser duplicado para o mesmo cliente.
* O mesmo endereço pode existir em clientes diferentes.
* O tipo (`AllowedIpType`) é calculado pelo backend.
* O frontend não define o tipo.
* O slug de uma Gateway Route é normalizado, único e não pode conflitar com prefixos administrativos reservados.
* A URL de destino de uma Gateway Route é normalizada e aceita somente `http`/`https`, sem credenciais ou fragmento.
* O `publicPath` de uma Gateway Route é calculado pelo backend (`/gateway` + slug) e não é persistido em banco.
* O valor de um Route Header é sempre criptografado (AES-256-GCM) antes de ser salvo; nunca em texto puro.
* Duplicidade de Route Header é bloqueada por rota (`gatewayRouteId` + `name` normalizado).
* Um Request Log nunca armazena segredos: API Key completa, hash, pepper, JWT, Route Header (criptografado ou decriptografado) ou a URL de destino.
* Um Request Log é criado exclusivamente pelo Gateway Proxy; não existe endpoint administrativo de escrita.
* Falha ao persistir um Request Log nunca altera a resposta devolvida pelo Proxy.

## Relacionamentos

```text
Client
├── ApiKeys
├── AllowedIps
├── GatewayRoutes
│   └── RouteHeaders
└── RequestLogs

RequestLog também referencia opcionalmente ApiKey e GatewayRoute
(onDelete: SetNull — a exclusão dessas entidades nunca apaga o histórico).
```
