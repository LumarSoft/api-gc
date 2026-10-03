# Project Structure

Keep this file up to date when adding modules or top-level folders.

```
api-gc/
├── docs/
│   ├── database.md                # Schema overview: domains, relationships, key decisions
│   ├── endpoints.md               # API endpoint reference (required for every endpoint)
│   └── rules/                     # Architecture and coding rules
│
├── prisma/
│   ├── migrations/                # Applied migration history (committed)
│   ├── seed/                      # Starter catalog (catalog.json + images) loaded by `npm run db:seed`
│   └── schema/                    # Single source of truth for the DB schema, one file per domain (docs/database.md)
│
├── src/
│   ├── auth/                      # Register, login, refresh, logout, password reset, email verification
│   ├── brands/                    # GET /brands
│   ├── categories/                # GET /categories (tree), GET /categories/:slug
│   ├── files/                     # Local file storage + public URLs (served at /files)
│   ├── pricing/                   # Price resolution: price lists per buyer, USD → ARS conversion
│   ├── products/                  # Public catalog: list with filters/sort/pagination, product page
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
├── test/                          # End-to-end tests
│
├── .husky/pre-commit              # Runs lint-staged (Prettier)
├── AGENTS.md                      # Guidance for AI agents and humans
├── CLAUDE.md                      # Imports AGENTS.md
├── STRUCTURE.md                   # This file
├── docker-compose.yml             # Local MySQL 8.4
└── prisma.config.ts
```

## Module overview

| Module           | Path              | Responsibility                    |
| ---------------- | ----------------- | --------------------------------- |
| AppModule        | `src/`            | Root module, health check         |
| PrismaModule     | `src/prisma/`     | Global DB access (PrismaService)  |
| MailModule       | `src/mail/`       | Global transactional email        |
| AuthModule       | `src/auth/`       | Sessions, passwords, email check  |
| FilesModule      | `src/files/`      | Global file storage + public URLs |
| PricingModule    | `src/pricing/`    | Price list per buyer, USD → ARS   |
| CategoriesModule | `src/categories/` | Category tree                     |
| BrandsModule     | `src/brands/`     | Brands                            |
| ProductsModule   | `src/products/`   | Public catalog                    |
