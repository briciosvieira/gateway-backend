# Visão do Produto

## Nome

Gateway Hub LF

## Descrição

O Gateway Hub LF é uma plataforma de integração responsável por controlar e proteger a comunicação entre sistemas externos e aplicações internas.

A plataforma funciona como uma camada intermediária entre o consumidor externo e o destino interno.

## Problema

Aplicações como n8n, ERPs, CRMs, APIs internas e sistemas legados não devem ser expostas diretamente para a internet.

A exposição direta dificulta:

* Controle de acesso
* Auditoria
* Identificação de falhas
* Gerenciamento de credenciais
* Restrição por IP
* Monitoramento
* Padronização das integrações

## Solução

O Gateway Hub LF recebe as requisições externas, aplica as regras de segurança e encaminha a chamada para o destino interno configurado.

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
      +--> Controle de permissões
      +--> Logs e auditoria
      |
      v
Aplicação interna
```

## Objetivos

* Centralizar integrações
* Proteger aplicações internas
* Controlar o acesso por API Key
* Restringir requisições por IP
* Registrar logs
* Disponibilizar auditoria
* Monitorar falhas e desempenho
* Permitir gerenciamento por interface
* Atender múltiplos clientes
* Atender múltiplos sistemas internos

## Público-alvo

* Equipes de infraestrutura
* Equipes de desenvolvimento
* Gestores de tecnologia
* Administradores de integração
* Clientes e parceiros autorizados

## Status

Backend em estágio avançado — todos os módulos planejados até o Dashboard estão concluídos e testados.

Módulos concluídos:

* Autenticação
* Usuários
* Perfis
* Clientes
* API Keys
* Allowed IPs
* Gateway Routes
* Route Headers
* Gateway Proxy
* Request Logs
* Dashboard
* Auditoria
* Health Check

### Recursos do módulo Allowed IPs

* Gerenciamento de IPs e redes autorizadas
* Suporte a IPv4, IPv6 e CIDR
* Whitelist por cliente

### Recursos do módulo Gateway Routes

* Cadastro de rotas públicas vinculadas a um cliente
* Slug público normalizado e único, com bloqueio de prefixos administrativos
* Validação e normalização da URL de destino (somente `http`/`https`, sem credenciais)
* Cálculo automático do caminho público (`publicPath`), não persistido em banco

### Recursos do módulo Route Headers

* Headers HTTP adicionais por Gateway Route, injetados automaticamente na chamada ao destino
* Valor sempre criptografado (AES-256-GCM) — nunca armazenado em texto puro
* Bloqueio de headers perigosos (`Host`, `Connection`, `Transfer-Encoding`, `Content-Length`, etc.)
* Normalização do nome para o formato HTTP Header-Case (`x-api-key` → `X-Api-Key`)
* Mascaramento (`********`) de valores marcados como sensíveis em qualquer consulta

### Recursos do módulo Gateway Proxy

* Endpoint público `/gateway/*`, fora do prefixo administrativo `/api/v1`
* Autenticação exclusiva por `X-API-Key` e Allowed IP do cliente — sem JWT administrativo
* Resposta transparente: status, body e um conjunto controlado de headers do destino
* Timeout e retry configuráveis por rota, com backoff entre tentativas
* Proteções contra SSRF: nunca segue redirects, só usa a URL persistida, nunca expõe o destino

### Recursos do módulo Request Logs

* Registro de toda chamada do Proxy, inclusive falhas antes da resolução completa da rota
* Nunca grava segredos: API Key completa, hash, pepper, JWT, Route Header (cripto ou decriptografado)
* Mascaramento recursivo de dados sensíveis em headers, query string e body
* Truncamento configurável do body armazenado, preservando o tamanho real estimado
* Leitura por `ADMIN`, `OPERATOR` e `AUDITOR` — `VIEWER` não tem acesso; nenhuma escrita manual

### Recursos do módulo Dashboard

* Indicadores agregados (clientes, API Keys, rotas, taxa de sucesso/erro, tempo de resposta)
* Série temporal de requisições, com granularidade automática (hora, dia ou semana)
* Rankings de clientes, rotas, códigos de erro e IPs de origem
* Filtro por período (`today`, `last7days`, `last30days`, `last90days`, `custom`)
* Somente leitura para todos os perfis, incluindo `VIEWER`

## Escopo inicial

* Autenticação administrativa
* Cadastro de usuários
* Cadastro de clientes
* Geração de API Keys
* Cadastro de rotas
* Cadastro de IPs permitidos
* Proxy HTTP
* Logs
* Auditoria
* Dashboard

## Escopo implementado

* Autenticação administrativa
* Usuários e perfis
* Primeiro acesso
* Refresh Token
* Clientes
* API Keys
* IPs permitidos
* Gateway Routes
* Route Headers
* Proxy HTTP
* Request Logs
* Dashboard
* Auditoria

## Próximas entregas

* Frontend administrativo
* Deploy em produção

## Escopo futuro

* Azure AD
* OAuth 2.0
* OpenID Connect
* Filas
* Retentativas avançadas
* Webhooks
* Alertas
* Prometheus
* Grafana
* Portal de clientes
* Modelo SaaS
