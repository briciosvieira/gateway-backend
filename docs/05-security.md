# Segurança

## HTTPS

Toda comunicação externa deverá utilizar HTTPS.

## API Keys

* Geradas de forma criptograficamente segura
* Exibidas somente uma vez
* Armazenadas com hash
* Associadas a clientes e rotas
* Revogáveis
* Com expiração opcional
* Armazenadas somente como hash SHA-256 com pepper
* A chave completa é exibida apenas na criação ou regeneração
* O hash nunca é retornado pela API
* O pepper fica exclusivamente nas variáveis de ambiente

## Senhas

* Hash com Argon2 ou bcrypt
* Política mínima de senha
* Primeiro acesso com troca obrigatória
* Recuperação por token temporário

## Allowed IPs

O Gateway Hub LF suporta whitelist por cliente utilizando:

* IPv4
* IPv6
* CIDR IPv4
* CIDR IPv6

Os endereços são validados e normalizados com `ipaddr.js`.

O backend não utiliza regex como mecanismo principal de validação.

Redes CIDR são convertidas para o endereço real da rede.

Exemplo:

```text
192.168.1.50/24
```

é armazenado como:

```text
192.168.1.0/24
```

Regras adicionais:

* O cliente deve estar ativo para cadastrar ou reativar um IP.
* O mesmo endereço pode ser utilizado por clientes diferentes.
* Duplicidades para o mesmo cliente são bloqueadas.
* O tipo do endereço é determinado exclusivamente pelo backend.

## Gateway Routes

* O slug público é normalizado (minúsculo, sempre iniciando com `/`) e validado quanto a caracteres permitidos.
* Slugs que colidam com prefixos administrativos reservados (`/api`, `/auth`, `/users`, `/clients`, `/api-keys`, `/allowed-ips`, `/audit-logs`, `/docs`, `/health`) são bloqueados.
* Espaços, query string, fragmento, protocolo, domínio e path traversal (`..`) no slug são rejeitados.
* A URL de destino aceita somente os protocolos `http` e `https`.
* A URL de destino não pode conter usuário, senha ou fragmento.
* A URL de destino nunca é exposta em rotas públicas ou logs de acesso.
* O `publicPath` é sempre calculado pelo backend, nunca informado pelo cliente da API.
* O cliente deve estar ativo para cadastrar ou reativar uma rota.

## Route Headers

* O valor de cada header é sempre criptografado com AES-256-GCM antes de ser salvo.
* A chave de criptografia (`HEADER_ENCRYPTION_KEY`) tem 32 bytes e fica exclusivamente nas variáveis de ambiente.
* O valor criptografado (`valueEncrypted`) nunca é retornado pela API.
* Headers marcados como `sensitive` são sempre mascarados (`********`) em qualquer consulta administrativa.
* Headers de protocolo/conexão são bloqueados no cadastro: `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `Proxy-Authorization`, `Proxy-Authenticate`, `Keep-Alive`, `TE`, `Trailer`, `Expect`.
* No Proxy, os valores decriptografados nunca são registrados em log ou auditoria.

## Gateway Proxy

* Autenticação exclusiva por `X-API-Key`; nenhum JWT administrativo é aceito no endpoint público.
* A API Key é aceita somente via header — nunca por query string, body, path ou cookie.
* O hash calculado é comparado ao hash armazenado com `timingSafeEqual`, resistente a timing attack.
* A resposta de erro de autenticação é sempre genérica (`INVALID_API_KEY`); a aplicação nunca revela qual validação específica falhou.
* Headers encaminhados ao destino seguem uma allow-list; `Authorization`, `Cookie`, `Set-Cookie`, `Host` e headers de conexão do cliente externo são sempre removidos.
* A API Key recebida nunca é encaminhada ao destino interno.
* A URL de destino é exclusivamente a persistida na Gateway Route — o request externo nunca define protocolo, host, porta ou path base.
* O Gateway nunca segue redirecionamentos (`3xx` é devolvido como recebido), reduzindo o risco de SSRF indireto.
* Erros gerados pelo próprio Gateway nunca expõem: URL de destino, hostname interno, porta interna, stack trace, API Key, hash, pepper ou headers internos.
* Retries só ocorrem em falha de conexão, timeout ou status `502`/`503`/`504` — nunca em erros `4xx` do destino, e nunca após uma resposta já ter sido enviada ao cliente.

## Request Logs

* Nunca são registrados: `X-API-Key`, `Authorization`, `Cookie`, `Set-Cookie`, API Key completa, hash de API Key, pepper, JWT, Refresh Token, senhas, Route Header (criptografado ou decriptografado), chaves de criptografia, URL de destino, hostname/porta interna ou stack trace.
* O mascaramento é recursivo e cobre objetos aninhados, arrays, strings e headers — por padrão, chaves como `authorization`, `password`, `secret`, `token`, `api_key`, entre outras, são substituídas por `********`.
* Strings muito longas são truncadas; arrays muito grandes são limitados; profundidade de objetos é limitada; referências circulares são tratadas com segurança.
* O corpo armazenado respeita um limite de bytes (`REQUEST_LOG_BODY_MAX_BYTES`) — acima do limite, é salva uma versão truncada com o tamanho real estimado, sem afetar a chamada real do Proxy.
* Erros do próprio Gateway (ex.: `API_KEY_REQUIRED`) não persistem headers, query ou body — apenas os campos essenciais de resolução.
* A criação de um Request Log nunca altera o status ou o corpo da resposta devolvida ao cliente externo, mesmo em caso de falha ao persistir.

## Proteções HTTP

* Helmet
* Rate Limit
* Body Limit
* Timeout
* CORS configurável
* CSP
* Trust Proxy
* Validação de payload

## Logs

Não deverão ser registrados em texto puro:

* Senhas
* Tokens JWT
* API Keys completas
* Cookies de sessão
* Headers sensíveis
* Dados sigilosos definidos pela aplicação

## Respostas

A aplicação não deverá expor:

* URLs internas
* Stack traces
* Credenciais
* Estrutura do banco
* Informações internas de infraestrutura

## Auditoria

Toda alteração administrativa relevante deverá registrar:

* Usuário
* Ação
* Data
* IP
* Registro alterado
* Valor anterior
* Valor novo
