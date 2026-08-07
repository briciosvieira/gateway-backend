# Current Task

## Status

Completed.

## Delivered

- Backend global branding/personalization
- New public endpoints:
  - `GET /api/v1/branding`
  - `GET /api/v1/branding/assets/logo`
  - `GET /api/v1/branding/assets/favicon`
  - `GET /api/v1/branding/assets/brand-image`
- New `ADMIN` endpoints:
  - `PATCH /api/v1/branding`
  - `POST /api/v1/branding/logo`
  - `POST /api/v1/branding/favicon`
  - `POST /api/v1/branding/brand-image`
  - `DELETE /api/v1/branding/logo`
  - `DELETE /api/v1/branding/favicon`
  - `DELETE /api/v1/branding/brand-image`
- Global `applicationName` editing
- Global custom logo, favicon, and brand image upload/replacement/removal
- PostgreSQL binary storage with safe metadata
- Safe SVG validation and binary signature checks
- Public binary asset serving with cache headers and versioned URLs
- Audit logging without raw bytes
- Swagger/OpenAPI update
- Unit, integration, e2e, build, and live backend verification completed

## Next Task

Frontend — Configuracoes > Personalizacao

- adicionar item `Personalizacao` abaixo de `Certificados`
- editar `applicationName`
- subir/remover logo
- subir/remover favicon
- subir/remover brand image
- aplicar branding dinamico em Sidebar, Home, Login, browser title e favicon
- manter fallback visual atual quando URLs de branding forem `null`
