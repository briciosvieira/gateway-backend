# ADR 0006 — Usar ipaddr.js

## Contexto

O Gateway Hub LF precisa validar e normalizar IPv4, IPv6 e redes CIDR.

## Decisão

Utilizar `ipaddr.js`.

## Motivos

* Suporte a IPv4
* Suporte a IPv6
* Suporte a CIDR
* Tipos TypeScript incluídos
* Normalização canônica
* Cálculo seguro do endereço de rede

## Consequências

A aplicação passa a depender da biblioteca para validação e normalização de endereços.
