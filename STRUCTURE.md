# Project Structure

Keep this file up to date when adding modules or top-level folders.

```
api-gc/
├── docs/
│   ├── database.md                # Schema overview: domains, relationships, key decisions
│   ├── endpoints.md               # API endpoint reference (required for every endpoint)
│   ├── upgrade-notes.md           # Manual steps after pulling (newest first)
│   └── rules/                     # Architecture and coding rules
│
├── prisma/
│   ├── migrations/                # Applied migration history (committed)
│   ├── seed/                      # Starter catalog (catalog.json + images) loaded by `npm run db:seed`
│   └── schema/                    # Single source of truth for the DB schema, one file per domain (docs/database.md)
│
├── src/
│   ├── audit-logs/                # AuditLogsService: records every admin change (who, what, from where)
│   ├── auth/                      # Register, login, refresh, logout, password reset, email verification
│   ├── brands/                    # GET /brands + /admin/brands
│   ├── categories/                # GET /categories (tree), GET /categories/:slug + /admin/categories
│   ├── files/                     # Local file storage, public URLs (/files), admin image upload
│   ├── inventory/                 # StockService: stock levels + movement ledger (manual adjustment, TODO(tango))
│   ├── pricing/                   # Price resolution + /admin/price-lists and /admin/exchange-rates
│   ├── tags/                      # GET /tags (catalog filters) + /admin/tags
│   ├── products/                  # Public catalog + /admin/products (admin-* services, reader, mapper, duplicator)
│   ├── common/                    # Shared guards (JwtAuthGuard, RolesGuard), decorators, auth types, helpers
│   ├── mail/                      # Transactional email (logged in development until a provider is set)
│   ├── scripts/                   # create-admin.ts (`npm run admin:create`), seed-catalog.ts (`npm run db:seed`)
│   ├── generated/prisma/          # Generated Prisma client — git-ignored, never edit
│   ├── prisma/                    # Global database module
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts      # MySQL pool config + connection lifecycle
│   ├── app.controller.ts          # GET /health
│   ├── app.controller.spec.ts
│   ├── app.module.ts              # Root module
│   ├── app.service.ts
│   └── main.ts                    # Bootstrap — port, CORS, global ValidationPipe
│
├── scripts/doctor.mjs             # `npm run doctor` — checks the local setup and prints fixes
├── test/                          # End-to-end tests
│
├── .claude/settings.json          # Claude Code: runs the doctor on session start
├── .husky/pre-commit              # Runs lint-staged (Prettier)
├── AGENTS.md                      # Guidance for AI agents and humans
├── CLAUDE.md                      # Imports AGENTS.md
├── STRUCTURE.md                   # This file
├── docker-compose.yml             # Local MySQL 8.4
└── prisma.config.ts
```

## Module overview

| Module           | Path              | Responsibility                               |
| ---------------- | ----------------- | -------------------------------------------- |
| AppModule        | `src/`            | Root module, health check                    |
| PrismaModule     | `src/prisma/`     | Global DB access (PrismaService)             |
| MailModule       | `src/mail/`       | Global transactional email                   |
| AuthModule       | `src/auth/`       | Sessions, passwords, email check             |
| AuditLogsModule  | `src/audit-logs/` | Global audit log of admin changes            |
| FilesModule      | `src/files/`      | Global file storage + image upload           |
| PricingModule    | `src/pricing/`    | Price list per buyer, USD → ARS, admin rates |
| InventoryModule  | `src/inventory/`  | Stock levels and movements                   |
| CategoriesModule | `src/categories/` | Category tree (public + admin)               |
| BrandsModule     | `src/brands/`     | Brands (public + admin)                      |
| ProductsModule   | `src/products/`   | Public catalog + admin products              |
| TagsModule       | `src/tags/`       | Tags for filters (public + admin)            |
