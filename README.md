# api-gc — NestJS + Prisma + MySQL

Backend for the Comunicaciones Gráficas e-commerce. Frontend: [front-gc](https://github.com/LumarSoft/front-gc).

> **Before writing code (humans or AI agents), read [AGENTS.md](AGENTS.md) and [docs/rules/](docs/rules/).**

## Installation

### 1. Prerequisites

| Tool    | Version | Check            |
| ------- | ------- | ---------------- |
| Node.js | 22+     | `node -v`        |
| npm     | 10+     | `npm -v`         |
| Git     | any     | `git --version`  |
| MySQL   | 8.x     | see step 3 below |

Using [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows)? Run
`nvm use` — the version is pinned in `.nvmrc`.

We recommend cloning both repos side by side:

```
CG/
├── api-gc/     # this repo
└── front-gc/
```

### 2. Clone and install

```bash
git clone git@github.com:LumarSoft/api-gc.git
cd api-gc
npm install
```

`npm install` also:

- generates the Prisma client into `src/generated/prisma` (git-ignored), and
- installs the Husky pre-commit hook that runs Prettier on staged files.

### 3. Get a MySQL database

Pick **one** option.

**Option A — Docker (recommended).** Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
npm run db:up        # MySQL 8.4 on localhost:3306, user root / password root, database cg
npm run db:down      # stop it (data is kept in a Docker volume)
```

**Option B — MySQL installed locally** (MySQL Installer, Laragon, XAMPP, Homebrew…). Make sure the server is running
and that you know a user with permission to create databases (usually `root`).

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `DATABASE_URL` in `.env` if you are not using Docker:

```bash
# Docker (default in .env.example)
DATABASE_URL="mysql://root:root@localhost:3306/cg"

# Local MySQL with password
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/cg"

# Local MySQL without password (Laragon/XAMPP default)
DATABASE_URL="mysql://root@localhost:3306/cg"
```

Use a user that can create databases: `prisma migrate dev` creates a temporary "shadow" database to detect schema
drift. The `cg` database itself is created automatically if it does not exist.

| Variable                   | Default                       | Description                                                |
| -------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `PORT`                     | `3001`                        | API port                                                   |
| `CORS_ORIGIN`              | `http://localhost:3000`       | Allowed origins, comma-separated                           |
| `DATABASE_URL`             | —                             | MySQL connection string                                    |
| `DB_POOL_CONNECTION_LIMIT` | `10`                          | Max DB connections                                         |
| `DB_POOL_IDLE_TIMEOUT`     | `60`                          | Idle seconds (keep below MySQL wait_timeout)               |
| `JWT_SECRET`               | —                             | 32+ random chars (required; see `.env.example`)            |
| `JWT_ACCESS_TTL_MINUTES`   | `15`                          | Access token lifetime                                      |
| `REFRESH_TOKEN_TTL_DAYS`   | `30`                          | Session lifetime                                           |
| `FRONT_URL`                | `http://localhost:3000`       | Base URL for links in emails                               |
| `COOKIE_DOMAIN`            | empty                         | Shared parent domain in production                         |
| `COOKIE_SECURE`            | `false`                       | `true` in production (HTTPS)                               |
| `TRUST_PROXY`              | `0`                           | Proxy hops in front of the API (usually `1` in production) |
| `STORAGE_DIR`              | `storage`                     | Local folder for uploaded files (git-ignored)              |
| `PUBLIC_FILES_URL`         | `http://localhost:3001/files` | Base URL of public files                                   |

### 5. Apply migrations

```bash
npx prisma migrate dev     # applies every migration in prisma/migrations
npx prisma generate        # regenerates the Prisma client (Prisma 7 does not do it on migrate)
```

### 6. Load the starter catalog (optional)

```bash
npm run db:seed           # ~40 real Epson products with photos; prices and stock are SAMPLE data
```

Safe to run again: it only creates what is missing.

### 7. Run

```bash
npm run dev                # watch mode → http://localhost:3001
```

### 8. Verify

```bash
curl http://localhost:3001/health
# {"status":"ok","database":"up"}
```

Optionally run the checks:

```bash
npm run lint
npm run test               # unit tests (no database needed)
npm run test:e2e           # end-to-end tests on a separate cg_test database (created on first run)
```

## Staying up to date

After every `git pull`, run `npm run doctor`: it tells you exactly what is missing (new env vars, migrations, seed…)
and how to fix it. The history of manual steps is in [docs/upgrade-notes.md](docs/upgrade-notes.md).

## Daily workflow

```bash
git pull
npm install                # if package.json changed
npx prisma migrate dev     # if there are new migrations
npx prisma generate        # always after migrate
npm run doctor             # checks everything else
npm run dev
```

Changed a file in `prisma/schema/`?

```bash
npx prisma migrate dev --name <descriptive-name>
npx prisma generate
```

Commit the generated `prisma/migrations/<timestamp>_<name>/` folder together with the schema. Never edit a migration
that is already on `main`. More in [docs/rules/database.md](docs/rules/database.md).

## Scripts

| Script                 | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run dev`          | Start in watch mode                                                |
| `npm run build`        | Compile to `dist/`                                                 |
| `npm run start:prod`   | Run the compiled build                                             |
| `npm run lint`         | ESLint (with auto-fix)                                             |
| `npm run format`       | Prettier on `src/` and `test/`                                     |
| `npm run test`         | Unit tests                                                         |
| `npm run test:e2e`     | End-to-end tests on a separate `<db>_test` database (needs MySQL)  |
| `npm run db:up`        | Start MySQL in Docker                                              |
| `npm run db:down`      | Stop MySQL in Docker                                               |
| `npx prisma studio`    | Browse and edit data in the browser                                |
| `npm run admin:create` | Create/promote an admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD` env vars) |
| `npm run db:seed`      | Load the starter catalog (idempotent)                              |

## Production build

```bash
npm ci
npx prisma migrate deploy  # applies pending migrations, never creates new ones
npm run build
npm run start:prod         # node dist/main
```

Set the environment variables from step 4 on the server (no `.env` file needed if the host injects them).

## Troubleshooting

| Problem                                                      | Fix                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL is not set` when starting                      | Create `.env` (step 4).                                                                           |
| `P1000: Authentication failed`                               | Wrong user/password in `DATABASE_URL`.                                                            |
| `P1001: Can't reach database server`                         | MySQL is not running or the port is wrong. With Docker: `npm run db:up` and `docker ps`.          |
| `P3014: Prisma Migrate could not create the shadow database` | The DB user cannot create databases. Use `root` locally.                                          |
| `npm run db:up` fails with "port 3306 is already allocated"  | A local MySQL is already using 3306. Use it (option B) or stop it.                                |
| TypeScript errors about missing Prisma models after a pull   | Run `npx prisma generate`.                                                                        |
| `EADDRINUSE :::3001`                                         | Something else uses the port. Stop it or change `PORT` in `.env`.                                 |
| Prettier did not run on commit                               | Run `npm install` (it installs the hook) and check `git config core.hooksPath` prints `.husky/_`. |
| `@nestjs/cli` 12 fails with `ERR_REQUIRE_CYCLE_MODULE`       | Use the project's CLI (`npx nest`, v11) instead of a global/latest one.                           |

## Docs

- [AGENTS.md](AGENTS.md) — project context, commands and rules for AI agents
- [STRUCTURE.md](STRUCTURE.md) — folder structure and modules
- [docs/endpoints.md](docs/endpoints.md) — API reference
- [docs/rules/](docs/rules/) — coding rules
