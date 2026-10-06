# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, Copilot…) and humans working in this repository.
**Read this file and every file in `docs/rules/` before writing code.**

## Start of every session (humans and AI agents)

1. Run `npm run doctor`. It checks Node, dependencies, `.env`, the Prisma client, pending migrations and the seed,
   and prints the exact command to fix each problem. (Claude Code runs it automatically on session start through
   `.claude/settings.json`.)
2. If it reports problems, fix them **before** any other work, using `docs/upgrade-notes.md` for context. Tell the
   user what you fixed and ask before steps that need their input (passwords, secrets).
3. When your change requires a manual step from the other developers (new env var, migration, seed, service…), add an
   entry at the top of `docs/upgrade-notes.md` and a check in `scripts/doctor.mjs` in the same PR.

## Project

E-commerce and sales automation platform for **Comunicaciones Gráficas SRL**, a print shop in Rosario (Argentina)
and official Epson reseller. Today they sell over WhatsApp and re-type every order into **Tango** (their ERP). The goal
is to let customers buy on their own and remove as much manual work as possible.

This repo is the **backend** (`api-gc`). The frontend lives in a separate repo (`front-gc`, Next.js).

Business scope (details in @docs/rules/business-rules.md):

- Catalog, cart and checkout. Products priced in ARS or USD (with a configurable exchange rate).
- Two buyer profiles: **retail** customers and **wholesale** companies. Wholesalers apply through a company sign-up
  form and an admin approves, rejects or pauses them. Approved wholesalers get their own price list and a
  **current account** (debt, due dates, partial payments).
- Payments through Mercado Pago (webhook confirmation) and bank transfer with receipt upload.
- Stock comes from Tango and is reserved while an order is being paid.
- Orders and invoicing are sent to Tango. **The Tango integration method is not defined yet.**
- Shipping: free in-store pickup, Rosario delivery with a free-shipping threshold, quoted (outsourced) shipping to the
  rest of the country.
- AI shopping assistant and a guided product configurator (basic / PRO mode).
- CRM and stats.

Guiding principle from the client: **less manual work, simpler processes, nothing that requires training more
people.** Between two solutions, pick the one that needs less human intervention.

## Commands

```bash
# Development
npm run dev              # Start with hot-reload (watch mode) — http://localhost:3001
npm run start:debug      # Start with debugger + watch

# Build & Production
npm run build            # Compile via nest build
npm run start:prod       # Run compiled output from dist/

# Lint, format & tests
npm run lint             # ESLint with auto-fix
npm run format           # Prettier on src/ and test/
npm run test             # Unit tests (Jest)
npm run test:e2e         # End-to-end tests (needs a running MySQL)

# Database
npm run db:up            # Start MySQL 8.4 in Docker
npx prisma migrate dev --name <descriptive-name>   # Create/apply a migration
npx prisma generate      # Regenerate Prisma client — REQUIRED after every migrate (Prisma 7 no longer does it)
npx prisma studio        # Prisma Studio GUI
```

## Local setup

When asked to set up or run the project locally, follow the **Installation** section of `README.md` step by step:

1. `npm install` (generates the Prisma client and installs the Husky hook).
2. If `.env` does not exist: `cp .env.example .env`. Never commit `.env`.
3. Database:
   - Check first whether something already listens on port 3306 (a local MySQL). If it does, use it instead of
     `npm run db:up`.
   - **Never guess database credentials.** If `DATABASE_URL` does not work (`P1000`), ask the user for the user and
     password and let them edit `.env`.
   - Docker is optional; if it is not installed, do not install it — ask the user which MySQL to use.
4. `npx prisma migrate dev`, then `npx prisma generate`.
5. `npm run dev` and verify `curl http://localhost:3001/health` returns `{"status":"ok","database":"up"}`.

Never run `prisma migrate reset`, `prisma db push` or drop databases without the user's explicit confirmation. If a
step fails, check the **Troubleshooting** table in `README.md` before trying anything else.

## Stack

- NestJS 11 (Express platform), TypeScript (`strictNullChecks` + `noImplicitAny`).
- Prisma 7 + **MySQL 8** through the `@prisma/adapter-mariadb` driver adapter.
- Generated Prisma client in `src/generated/prisma` (git-ignored, regenerated on `npm install`).
- `class-validator` + `class-transformer` with a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`).
- `@nestjs/config` loaded globally.
- Prettier enforced on every commit via Husky + lint-staged.

## Architecture

Each business feature is a NestJS module in `src/<feature>/` (`*.module.ts`, `*.controller.ts`, `*.service.ts`,
`dto/`). Everything is wired into `AppModule`. `PrismaModule` is global and `PrismaService` is the only database
access point. External providers (Tango, Mercado Pago, shipping, AI) live in their own modules behind an interface —
see @docs/rules/integrations.md.

Current state: the **full database schema** is defined (`prisma/schema/`, one file per domain — see
@docs/database.md) and migrated. Implemented modules: `AuthModule` (cookie sessions, roles — protect routes with
`@UseGuards(JwtAuthGuard)` / `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)`; use
`OptionalJwtAuthGuard` + `@OptionalUser()` on public routes whose answer depends on the buyer), `CartModule`
(guest/user carts, merged on the first cart request after login; browser-only `/cart` routes), `CheckoutModule`
(contact/delivery preview and guest order confirmation under `/cart/checkout`), `OrdersModule`
(private capability-based tracking, manual admin payment/status updates and automatic reservation expiration), `MailModule`,
`FilesModule` (storage + admin image upload), `AuditLogsModule` (record every admin change — see "Admin routes" in
@docs/rules/architecture.md), `PricingModule` (always resolve prices through `PricingService`, never by hand) and the public
catalog (`CategoriesModule`, `BrandsModule`, `TagsModule`, `ProductsModule`; categories, brands and tags also
have `/admin/*` routes). `npm run db:seed` loads a starter catalog. See
`STRUCTURE.md`.

## Rules

- @docs/rules/architecture.md — module structure
- @docs/rules/business-rules.md — money, stock, orders, wholesale accounts
- @docs/rules/integrations.md — Tango, Mercado Pago, shipping, AI
- @docs/rules/database.md — Prisma and MySQL
- @docs/rules/validation.md — DTOs and validation
- @docs/rules/error-handling.md — exceptions
- @docs/rules/security.md — auth, secrets, webhooks
- @docs/rules/naming.md — naming conventions
- @docs/rules/documentation.md — endpoint documentation (`docs/endpoints.md`)
- @docs/rules/commits.md — commit conventions

## Rules for AI agents

1. **Scope**: do only what was asked. Do not refactor, rename or "improve" unrelated code — mention it at the end
   instead.
2. **Do not invent**: no Tango endpoints, Mercado Pago fields or business rules that are not in `docs/rules/` or in
   the request. If information is missing, ask or leave an explicit `TODO(<topic>):`.
3. **Follow existing patterns**: before creating a module, read an existing one and mirror its structure.
4. **Dependencies**: do not add packages without justifying it in your final summary.
5. **Do not touch**: `src/generated/`, already-applied migrations, `package-lock.json` by hand, or
   TypeScript/ESLint/Prettier config to silence errors. No `eslint-disable` / `@ts-ignore` without a comment
   explaining why.
6. **Verify before finishing**: `npm run lint`, `npm run test` and `npm run build` pass. Schema changed → the
   migration exists. New endpoint → documented in `docs/endpoints.md`. Structure changed → `STRUCTURE.md` updated.
7. **Only model what is used now**: add tables or columns only together with the code that uses them in the same
   change. Existing models without code are provisional — review them before building on them. See
   `docs/rules/database.md`.
8. **Final summary**: what you changed, what you could not verify, and any decision you made on your own.
