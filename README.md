# Gateway Hub LF

> Secure your integrations. Connect everything.

## Sobre o projeto

O Gateway Hub LF é uma plataforma de integração responsável por proteger aplicações internas por meio de uma camada segura de comunicação.

Em vez de expor diretamente serviços como n8n, APIs internas, ERP, CRM e sistemas legados, todas as requisições externas passam pelo Gateway Hub LF.

O Gateway valida a origem da requisição, a API Key, os IPs permitidos e as permissões da integração antes de encaminhar a chamada para o destino configurado.

## Principais recursos

* Autenticação com JWT, Refresh Token e primeiro acesso obrigatório
* Controle de usuários e perfis (`ADMIN`, `OPERATOR`, `VIEWER`, `AUDITOR`)
* Gerenciamento de clientes
* API Keys por cliente, com hash SHA-256 + pepper e exibição única
* Controle de acesso por IP (IPv4, IPv6 e CIDR)
* Rotas públicas dinâmicas (Gateway Routes)
* Headers de rota criptografados (AES-256-GCM), injetados na chamada ao destino
* Proxy HTTP transparente, com timeout, retry e proteções contra SSRF
* Logs de cada requisição do Proxy, com mascaramento de dados sensíveis
* Auditoria administrativa de todas as operações de escrita
* Dashboard com indicadores agregados para o Frontend
* Proteção de aplicações internas (n8n, APIs, ERP, CRM, sistemas legados)

## Stack

### Backend

* NestJS 11
* Fastify Adapter
* TypeScript estrito
* Prisma 7 (`prisma-client` + driver adapter `@prisma/adapter-pg`)
* PostgreSQL
* JWT e Refresh Token
* Argon2 (senhas)
* `ipaddr.js` (validação e normalização de IPv4/IPv6/CIDR)
* `undici` (chamadas HTTP do Proxy, com pool de conexões nativo)
* AES-256-GCM (criptografia dos valores de Route Headers)
* Swagger / OpenAPI

### Frontend

*Ainda não iniciado.* Está planejado com:

* React
* Vite
* TypeScript
* React Router
* Axios
* TanStack Query
* React Hook Form
* Zod
* TailwindCSS
* Shadcn UI

### Infraestrutura

*Ainda não iniciado.* Está planejado com:

* Ubuntu Server
* Docker
* Docker Compose
* PostgreSQL
* Nginx
* Let's Encrypt

## Arquitetura resumida

```text
Cliente externo
      |
      v
Nginx + HTTPS
      |
      v
Gateway Hub LF
      |
      +--> Validação de API Key
      +--> Validação de IPv4 / IPv6 / CIDR
      +--> Validação do cliente
      +--> Descriptografia dos Route Headers
      +--> Logs e auditoria
      |
      v
Aplicação interna
```

## Estrutura do repositório

Atualmente o backend vive na raiz do repositório (o Frontend ainda não foi iniciado):

```text
gateway-hub-lf/
├── src/
│   ├── modules/       # auth, users, roles, clients, api-keys, allowed-ips,
│   │                  # gateway-routes, route-headers, gateway-proxy,
│   │                  # request-logs, dashboard, audit-logs, health
│   ├── database/      # PrismaService / PrismaModule
│   └── common/        # decorators, interceptors, filters, interfaces
├── prisma/            # schema.prisma e migrations
├── generated/          # Prisma Client gerado
├── docs/               # documentação do produto e da arquitetura
└── README.md
```

## Documentação

* [Visão do produto](docs/01-vision.md)
* [Arquitetura](docs/02-architecture.md)
* [Banco de dados](docs/03-database.md)
* [API](docs/04-api.md)
* [Segurança](docs/05-security.md)
* [Deploy](docs/06-deployment.md)
* [Roadmap](docs/07-roadmap.md)
* [Testes](docs/08-testing.md)
* [Guia de instalação](docs/install.md)
* [ADRs](docs/adr/)

## Status

Backend em estágio avançado: todos os módulos até o Dashboard estão implementados e testados (ver [Roadmap](docs/07-roadmap.md)). Frontend e deploy em produção ainda não foram iniciados.

## Objetivo

Criar uma plataforma reutilizável para proteger, administrar e monitorar integrações entre ambientes externos e aplicações internas.
