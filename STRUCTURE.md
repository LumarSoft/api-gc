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
│   ├── cart/                      # Guest/user carts, login merge, current prices and stock validation
│   ├── checkout/                  # Contact validation, configured delivery and current-price preview and order confirmation
│   ├── brands/                    # GET /brands + /admin/brands
│   ├── categories/                # GET /categories (tree), GET /categories/:slug + /admin/categories
│   ├── files/                     # Local file storage, public URLs (/files), admin image upload
│   ├── orders/                    # Guest snapshots, private tracking, admin lifecycle and reservation expiration
│   ├── dashboard/                 # GET /admin/dashboard: 30-day sales/orders and to-do counts for the admin home
│   ├── analytics/                 # GET /admin/analytics(+/behavior): stats page (sales, rankings, customers, visitors)
│   ├── activity/                  # POST /activity: anonymous store activity reported by the browser
│   ├── settings/                  # /admin/settings: Rosario delivery rate and reservation window
│   ├── shipping/                  # Carrier provider behind SHIPPING_CARRIER (zipnova/ adapter) + cart shipping quotes
│   ├── shipments/                 # Carrier shipments of orders: admin booking/labels/cancel + provider webhook
│   ├── mercado-pago/              # Online payment provider behind PAYMENT_GATEWAY (Mercado Pago Checkout Pro)
│   ├── payments/                  # Paying orders online: checkout link, buyer's return refresh, Mercado Pago webhook
│   ├── inventory/                 # StockService: stock levels + movement ledger (manual adjustment, TODO(tango))
│   ├── pricing/                   # Price resolution + /admin/price-lists and /admin/exchange-rates
│   ├── tags/                      # GET /tags (catalog filters) + /admin/tags
│   ├── products/                  # Public catalog + /admin/products (admin-* services, reader, mapper, duplicator, bulk)
│   ├── common/                    # Shared guards (JwtAuthGuard, RolesGuard), decorators, auth types, helpers
│   ├── mail/                      # Transactional email (logged in development until a provider is set)
│   ├── scripts/                   # create-admin.ts (`npm run admin:create`), seed-catalog.ts (`npm run db:seed`)
│   ├── generated/prisma/          # Generated Prisma client — git-ignored, never edit
│   ├── prisma/                    # Global database module
│   │   ├── migration-check.ts     # Startup: refuse to run with pending migrations
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts      # MySQL pool config + connection lifecycle
│   ├── app.controller.ts          # GET /health
│   ├── app.controller.spec.ts
│   ├── app.module.ts              # Root module
│   ├── app.service.ts
│   └── main.ts                    # Bootstrap — port, CORS, global ValidationPipe
│
├── scripts/doctor.mjs             # `npm run doctor` — checks the local setup and prints fixes
├── scripts/after-pull.mjs         # Run by the post-pull git hooks: new upgrade notes + doctor
├── test/                          # End-to-end tests
│   └── setup/                     # Points e2e at the test database, creates and migrates it
│
├── .claude/settings.json          # Claude Code: runs the doctor on session start
├── .cursor/rules/project.mdc      # Cursor: points to AGENTS.md
├── .github/copilot-instructions.md # Copilot: points to AGENTS.md
├── .husky/pre-commit              # Runs lint-staged (Prettier)
├── .husky/post-{merge,checkout,rewrite} # After pull / branch switch: scripts/after-pull.mjs
├── .github/pull_request_template.md # "Pasos después de mergear" checklist for every PR
├── AGENTS.md                      # Guidance for AI agents and humans
├── CLAUDE.md                      # Imports AGENTS.md
├── STRUCTURE.md                   # This file
├── docker-compose.yml             # Local MySQL 8.4
└── prisma.config.ts
```

## Module overview

| Module            | Path                | Responsibility                                            |
| ----------------- | ------------------- | --------------------------------------------------------- |
| AppModule         | `src/`              | Root module, health check                                 |
| PrismaModule      | `src/prisma/`       | Global DB access (PrismaService)                          |
| MailModule        | `src/mail/`         | Global transactional email                                |
| AuthModule        | `src/auth/`         | Sessions, passwords, email check                          |
| OrdersModule      | `src/orders/`       | Guest orders, tracking, manual lifecycle and reservations |
| CartModule        | `src/cart/`         | Cookie-owned carts, merge, prices and stock               |
| AuditLogsModule   | `src/audit-logs/`   | Global audit log of admin changes                         |
| FilesModule       | `src/files/`        | Global file storage + image upload                        |
| PricingModule     | `src/pricing/`      | Price list per buyer, USD → ARS, admin rates              |
| InventoryModule   | `src/inventory/`    | Stock levels and movements                                |
| CategoriesModule  | `src/categories/`   | Category tree (public + admin)                            |
| BrandsModule      | `src/brands/`       | Brands (public + admin)                                   |
| ProductsModule    | `src/products/`     | Public catalog + admin products                           |
| TagsModule        | `src/tags/`         | Tags for filters (public + admin)                         |
| DashboardModule   | `src/dashboard/`    | Admin home metrics (read-only aggregates)                 |
| AnalyticsModule   | `src/analytics/`    | Admin stats page (read-only aggregates)                   |
| ActivityModule    | `src/activity/`     | Anonymous store activity for stats                        |
| ShippingModule    | `src/shipping/`     | Carrier provider (Zipnova) and cart shipping quotes       |
| ShipmentsModule   | `src/shipments/`    | Order shipments: booking, documents, status webhook       |
| MercadoPagoModule | `src/mercado-pago/` | Payment provider (Mercado Pago) behind `PAYMENT_GATEWAY`  |
| PaymentsModule    | `src/payments/`     | Online payment of orders and the Mercado Pago webhook     |
