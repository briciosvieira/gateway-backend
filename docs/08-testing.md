# Testes

Testes executados manualmente contra a API real (autenticação, permissões e auditoria), com usuários e dados temporários removidos ao final de cada rodada.

## Clients

Foram executados 34 testes com sucesso.

### Casos cobertos

- Criação
- Código duplicado
- Listagem
- Busca textual
- Filtro por status
- Filtro por código
- Ordenação
- Busca por ID
- Atualização
- Desativação
- Reativação
- ID inexistente
- UUID inválido
- Payload inválido
- Permissões
- Auditoria

## API Keys

Foram executados 51 testes com sucesso.

### Casos cobertos

- Criação
- Formato `ghlf_<prefix>_<secret>`
- Hash nunca retornado
- Chave completa nunca retornada em consultas ou listagem
- Cliente inexistente
- Cliente inativo bloqueando criação
- Expiração passada
- Paginação
- Filtros
- Atualização
- Ativação
- Desativação
- Revogação (idempotente)
- Chave revogada não pode ser reativada
- Chave expirada não pode ser ativada
- Regeneração (novo registro, revoga a anterior)
- Permissões
- Auditoria

## Allowed IPs

Foram executados 45 testes com sucesso.

### Casos cobertos

- IPv4
- IPv6
- CIDR IPv4
- CIDR IPv6
- Normalização
- Redes CIDR
- Endereços inválidos
- Máscaras inválidas
- Cliente inexistente
- Cliente inativo
- Duplicidade
- Paginação
- Filtros
- Pesquisa
- Atualização
- Ativação
- Desativação
- Permissões
- Auditoria

## Gateway Routes

Foram executados 39 testes com sucesso.

### Casos cobertos

- Criação válida
- Normalização de slug (minúsculo, `/` inicial)
- Cálculo do `publicPath`
- Slug duplicado
- Slug inválido (espaço, caracteres não permitidos)
- Prefixo administrativo reservado
- Cliente inexistente
- Cliente inativo bloqueando criação
- URL de destino inválida
- URL de destino com credenciais
- Método HTTP inválido
- Timeout fora do intervalo permitido
- Retry acima do máximo
- Paginação
- Filtros
- Pesquisa
- Atualização
- Conflito de slug na atualização
- Ativação
- Desativação
- Cliente inativo bloqueando reativação
- Permissões
- Auditoria

## Route Headers

Foram executados 47 testes com sucesso.

### Casos cobertos

- Criação de header sensível e não sensível
- Normalização do nome (Header-Case)
- Bloqueio dos 11 headers proibidos
- Nome inválido
- Duplicidade na mesma rota
- Rota inexistente
- Rota inativa bloqueando criação
- `valueEncrypted` nunca retornado (create, get, list)
- Mascaramento (`********`) de valor sensível
- Valor não sensível retornado decriptografado
- Filtros (`gatewayRouteId`, `headerName`, `active`, `sensitive`)
- Pesquisa e paginação
- Atualização de valor (gera nova criptografia) e de `sensitive`
- Conflito de nome na atualização
- Ativação e desativação
- Permissões
- Auditoria (valores decriptografados, `valueEncrypted` e a chave de criptografia nunca aparecem nos logs)

## Gateway Proxy

Foram executados 43 testes principais + 12 testes de regressão (após a integração do módulo Request Logs) com sucesso.

### Casos cobertos

- Rota válida com API Key e IP autorizado
- GET com query string, POST/PATCH com body JSON
- Status 201/400/500 do destino preservados
- Content-Type preservado
- Header `X-` customizado do cliente encaminhado
- Route Header (sensível e não sensível) decriptografado e enviado ao destino, com o inativo omitido
- `X-API-Key` e headers perigosos (`Cookie`, `Authorization` externo, `Host`, etc.) nunca encaminhados
- `X-Gateway-Request-Id` / `X-Gateway-Source-Ip` adicionados ao destino
- API Key ausente / malformada / inativa / revogada / expirada / de outro cliente → 401
- Cliente inativo → 403 (validado em rota própria do cliente inativo, checado antes da API Key)
- IP não autorizado e cliente sem Allowed IP ativo → 403 (bloqueio por padrão)
- Rota inexistente ou inativa → 404
- Método incorreto → 405 (com header `Allow`)
- Timeout → 504
- Destino offline → 502
- Retry funcionando (parando nas condições certas, contagem correta)
- Redirect 3xx não seguido
- `destinationUrl` e porta interna nunca aparecem em erros públicos

## Request Logs

Foram executados 47 testes com sucesso.

### Casos cobertos

- Chamada de sucesso gera log `SUCCESS`; status 201/500 do upstream logados corretamente
- `errorCode` nulo quando o erro é uma resposta real do destino (não do Gateway)
- API Key ausente/inválida geram log 401 com `apiKeyId` nulo quando o prefixo não existe
- Rota inexistente gera log 404 com `clientId`/`apiKeyId`/`gatewayRouteId` todos nulos
- Método incorreto, timeout e destino offline gerados corretamente (405/504/502), com `attempts` refletindo o retry
- Upstream sempre-erro (503) repassado transparentemente como `ERROR`, com `attempts` corretos
- `requestId` do log idêntico ao devolvido ao cliente
- Mascaramento: senha em body, `x-api-key`, Route Header sensível decriptografado, `valueEncrypted`, chave completa — nenhum aparece no log
- `requestSizeBytes` / `responseSizeBytes` gravados
- Paginação, filtros (cliente, rota, API Key, resultado, código de erro, período com validação `startDate<=endDate`)
- Busca por Request ID, consulta por ID
- Permissões (`VIEWER` 403; `ADMIN`/`OPERATOR`/`AUDITOR` 200)

## Dashboard

Foram executados 66 testes com sucesso, incluindo carga com 3.000 Request Logs sintéticos.

### Casos cobertos

- `overview` nos 4 presets de período + `custom` válido/inválido (datas ausentes ou invertidas → 400)
- Cenário sem dados (janela sem logs) → valores zerados com segurança, sem erro
- Série temporal com granularidade automática (hora em `today`, dia em `last7days`/`last30days`, semana em `last90days`), com `requests === success + error` em cada ponto
- `top-clients` / `top-routes` respeitando `limit` e ordenados por volume
- `status-distribution`
- `top-errors` nunca incluindo `errorCode` nulo
- `top-source-ips`
- `recent-requests` retornando exatamente 20 itens ordenados por `createdAt desc`
- `health` reportando `healthy`/`healthy`, `uptimeSeconds` e `version`
- Todos os quatro perfis (`ADMIN`, `OPERATOR`, `AUDITOR`, `VIEWER`) com acesso de leitura
- Performance: todas as consultas responderam entre 6 e 14 ms com ~3.000 logs

## Resultado

```text
npx tsc --noEmit
Exit code: 0
```
