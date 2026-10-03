# api-gc — NestJS + Prisma + MySQL

Backend for the Comunicaciones Gráficas e-commerce. Frontend: `front-gc` (Next.js).

> **Before writing code (humans or AI agents), read [AGENTS.md](AGENTS.md) and [docs/rules/](docs/rules/).**

## Prerequisites

- Node.js 22+ (`nvm use` reads `.nvmrc`)
- MySQL 8: via Docker (`npm run db:up`) or installed locally

## Quick start

```bash
git clone <repo-url>
cd api-gc
npm install                 # also generates the Prisma client and installs the Husky hook
cp .env.example .env
npm run db:up               # MySQL 8.4 in Docker (skip if you use a local MySQL)
npx prisma migrate dev      # applies all migrations in order
npm run dev                 # http://localhost:3001
```

Check: `curl http://localhost:3001/health` → `{"status":"ok","database":"up"}`

## Working with the database

- Changed `prisma/schema.prisma` → `npx prisma migrate dev --name <descriptive-name>`, then `npx prisma generate`,
  and commit the generated migration together with the schema.
- Pulled and there are new migrations → `npx prisma migrate dev` and `npx prisma generate`.
- Prisma 7: `migrate dev` does **not** regenerate the client — always run `npx prisma generate` afterwards.
- Never edit a migration that is already on the main branch.

## Docs

- [AGENTS.md](AGENTS.md) — project context, commands and rules for AI agents
- [STRUCTURE.md](STRUCTURE.md) — folder structure and modules
- [docs/endpoints.md](docs/endpoints.md) — API reference
- [docs/rules/](docs/rules/) — coding rules
