# Deploy

## Ambiente

* Ubuntu Server
* Docker
* Docker Compose
* Nginx
* PostgreSQL existente
* Certificado Let's Encrypt

## Banco de dados

Será criado um banco separado dentro do PostgreSQL existente.

```text
Database: gateway_hub_lf
User: gateway_hub_lf_user
Port: mesma porta do PostgreSQL existente
```

Bancos diferentes podem utilizar a mesma porta sem conflito.

## Containers

Inicialmente serão utilizados containers para:

* Backend
* Frontend

O PostgreSQL existente será reutilizado.

## Variáveis de ambiente do backend

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3110

DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/gateway_hub_lf

INITIAL_ADMIN_NAME=
INITIAL_ADMIN_USERNAME=
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

API_KEY_PEPPER=
HEADER_ENCRYPTION_KEY=

REQUEST_LOG_BODY_MAX_BYTES=16384
REQUEST_LOG_RETENTION_DAYS=90

CORS_ORIGINS=
TRUST_PROXY=true
```

`API_KEY_PEPPER` deve ter uma string forte e única (não reaproveitar entre ambientes). `HEADER_ENCRYPTION_KEY` deve decodificar para exatamente 32 bytes (64 caracteres hexadecimais) — usada em AES-256-GCM para os Route Headers. `REQUEST_LOG_RETENTION_DAYS` é apenas documentado nesta etapa; a rotina de retenção automática ainda não foi implementada (ver [Roadmap](07-roadmap.md)).

## Variáveis de ambiente do frontend

```env
VITE_APP_NAME=Gateway Hub LF
VITE_API_URL=/api
```

## Nginx

O Nginx será responsável por:

* Certificado SSL
* Redirecionamento HTTP para HTTPS
* Proxy para o frontend
* Proxy para o backend
* Limites básicos
* Preservação do IP real
* Headers de segurança

## Processo de deploy

```text
Git
 |
 v
Build dos containers
 |
 v
Execução das migrations
 |
 v
Inicialização do backend
 |
 v
Inicialização do frontend
 |
 v
Nginx
 |
 v
Health Check
```
