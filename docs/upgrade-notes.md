# Upgrade notes

Manual steps needed after pulling. **Newest first.** `npm run doctor` checks most of them automatically.

Every PR that needs a manual step (new env var, migration, seed, new service to run…) adds an entry here **and**, when
possible, a check in `scripts/doctor.mjs`.

## Always, after every pull

```bash
npm install
npx prisma migrate dev     # applies new migrations (creates none if the schema did not change)
npx prisma generate        # Prisma 7 does not regenerate the client on migrate
npm run doctor             # tells you if anything else is missing
```

---

## 2026-10-10 — Online payment with Mercado Pago (migration, env vars)

Checkout can take payments online with Mercado Pago Checkout Pro. `Payment` loses the unused `preferenceId` column, so
apply the migration and regenerate the client:

```bash
npx prisma migrate dev
npx prisma generate
```

Copy the new `MERCADO_PAGO_*` variables from `.env.example` into `.env`. **An empty access token keeps Mercado Pago
off** (checkout only offers paying at the store), which is fine for local work. To try it in sandbox:

1. In Mercado Pago Developers (Tus integraciones) create or open the app, then "Cuentas de prueba": create a **seller**
   and a **buyer** test user (Argentina).
2. Log in as the seller test user (incognito window), open the app → "Credenciales de producción" and copy the access
   token (`APP_USR-…`) into `MERCADO_PAGO_ACCESS_TOKEN`. (A `TEST-…` token of your own account also works.)
3. Set `MERCADO_PAGO_REFERENCE_PREFIX` (e.g. `DEV-<your name>-`) when the test account is shared, so your orders
   `CG-000001…` never take someone else's payments.
4. Pay as the buyer test user (another incognito window) with one of Mercado Pago's test cards for Argentina
   (Developers → "Tarjetas de prueba"); the holder name picks the result: `APRO` approved, `OTHE` rejected.

Locally Mercado Pago cannot reach the webhook, so leave `MERCADO_PAGO_NOTIFICATION_URL` empty: the payment is read
from Mercado Pago when the buyer comes back to the store (the order's payment page). To test the webhook, expose the
API with a tunnel, set the https URL of `POST /payments/webhooks/mercado-pago` and the app's webhook secret
(`MERCADO_PAGO_WEBHOOK_SECRET`, Webhooks → Clave secreta).

Production: `npx prisma migrate deploy`, the client's production access token, `MERCADO_PAGO_NOTIFICATION_URL` set to
`https://<api>/payments/webhooks/mercado-pago`, and in the app's Webhooks settings the same URL with the **Pagos**
event and its secret in `MERCADO_PAGO_WEBHOOK_SECRET`. Leave `MERCADO_PAGO_REFERENCE_PREFIX` empty.

---

## 2026-10-10 — Weight and measurements required to publish (migration)

The "Voluminoso" flag of variants is removed (large equipment is quoted like any product), so apply the migration:

```bash
npx prisma migrate dev
npx prisma generate
```

Production: `npx prisma migrate deploy` before starting the new build.

From now on a product needs weight and the three measurements on every active variant to be published. Products
already published without them stay published, but cannot be shipped to the rest of the country until they are
completed: the admin product list has a "Sin peso o medidas" filter for them (the starter catalog from `db:seed` has
none, so locally every seeded product shows up there).

---

## 2026-10-09 — Carrier shipping through Zipnova (migration, env vars)

Checkout can quote and book shipping to the rest of the country through Zipnova (Correo Argentino, OCA and others).
`ShippingQuote` and `Shipment` change shape (both were empty) and `ShipmentStatus` changes values. Apply the migration
and regenerate the client:

```bash
npx prisma migrate dev
npx prisma generate
```

Copy the new `ZIPNOVA_*` variables from `.env.example` into `.env`. **Empty credentials keep carrier shipping off**
(checkout shows it as unavailable), which is fine for local work. To use it, create your own Zipnova account (free
Starter plan), or ask Mateo for the development account's key and secret and then **set `ZIPNOVA_REFERENCE_PREFIX`**
(e.g. `DEV-<your name>-`) so your orders `CG-000001…` never collide with someone else's. Fill:

- `ZIPNOVA_API_KEY`, `ZIPNOVA_API_SECRET`, `ZIPNOVA_ACCOUNT_ID`: Zipnova → Configuración → Integraciones →
  Gestionar credenciales y webhooks.
- `ZIPNOVA_ORIGIN_ID`: id of the dispatch location (Configuración → Ubicaciones).
- `ZIPNOVA_WEBHOOK_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Products need weight and measurements (admin → product → variants) to be quoted.

Production: `npx prisma migrate deploy`, set the variables with the client's Zipnova account, and in Zipnova create a
webhook with topic `status` and URL `https://<API domain>/shipping/webhooks/<ZIPNOVA_WEBHOOK_SECRET>`. Keep the
account in Zipnova's test mode until the first bookings have been checked. Leave `ZIPNOVA_REFERENCE_PREFIX` empty.
The webhook secret travels in the URL path: exclude `/shipping/webhooks/` from the Nginx access log
(`location /shipping/webhooks/ { access_log off; ... }`). `npm run doctor` warns about a half configuration.

---

## 2026-10-08 — Pending setup notice for people and AI agents

Nothing to run. While `npm run doctor` finds errors it writes `PENDING-SETUP.md` (git-ignored) at the repository root
with the missing steps; it deletes it once everything passes. `AGENTS.md` (read by Claude Code, Codex, Cursor and
Copilot; `.cursor/rules/` and `.github/copilot-instructions.md` point to it) tells AI agents to fix those steps before
the user's task.

---

## 2026-10-08 — Setup checks after pull and on startup

Nothing to run: this is how pending steps reach you from now on.

- After `git pull` (also merge, rebase, branch switch) the git hooks show the new entries of this file and run the
  doctor when something relevant changed. They come with Husky, already installed by `npm install`.
- **The API does not start if the database is missing migrations.** It logs which ones and the command
  (`npx prisma migrate dev` locally, `npx prisma migrate deploy` in production). Production deploys must run
  `npx prisma migrate deploy` from the repository folder before restarting the API (PM2): the check reads
  `prisma/migrations` from the process' working directory, so start PM2 from the repository root (if the folder is not
  there, the API starts and only logs a warning).

---

## 2026-10-08 — Anonymous store activity (migration)

`ActivityEvent` gets its first writer (`POST /activity`) and changes shape: anonymous `visitorId` instead of
`userId`/`sessionId`, `resultCount` for searches, no `metadata`, and only the event types in use. The table was never
written, so nothing is lost. Apply the migration and regenerate the client:

```bash
npx prisma migrate dev
npx prisma generate
```

Production: `npx prisma migrate deploy` before starting the new build. `npm run doctor` flags the pending migration.

---

## 2026-10-06 — Separate database for the e2e tests

`npm run test:e2e` used `DATABASE_URL`, so every run left "Order Test" orders, carts, products and users in the
development database (they only get soft-deleted or cancelled). The suites now run against a separate database:
`TEST_DATABASE_URL` if set, otherwise `DATABASE_URL` with `_test` appended to the name (`cg` → `cg_test`).

Nothing to do if your MySQL user can create databases: the next `npm run test:e2e` creates `cg_test`, applies the
migrations and inserts the default retail price list. Otherwise create it once with a privileged user:

```sql
CREATE DATABASE cg_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL ON cg_test.* TO 'cg'@'%';
```

`npm run doctor` reports whether the test database exists and is reachable, and fails if `TEST_DATABASE_URL` points
to the development database (the e2e setup refuses to run in that case).

Rows that earlier runs left in the development database are **not** removed automatically. They are test fixtures
(emails ending in `@example.test`, names like "Order Test" / "Cart test product"); clean them up by hand if you want,
or re-create the development database from the seed.

## 2026-10-06 — Frequent-customer applications

Restart the API after pulling so `/wholesale-applications` and `/admin/wholesale-applications` are available. No new
dependencies, environment variables or migrations (uses the existing `Company` and `WholesaleApplication` tables).

## 2026-10-06 — Offers filter and favorites

Restart the API after pulling so `GET /products?onSale=true` and `/favorites` are available. No new dependencies,
environment variables or migrations: favorites use the existing `Favorite` table.

## 2026-10-05 — Guest orders and private tracking

Apply migration `20261005000000_guest_orders`, regenerate Prisma and restart the API. No new dependencies, secrets
or external providers. The migration makes `Order.userId` nullable, adds a unique nullable tracking-token hash and
adds `MANUAL` payment. Existing orders/relationships are retained. Doctor already checks migrations and generated types.

```bash
npx prisma migrate deploy
npx prisma generate
npm run doctor
```

Migration was generated with Prisma `migrate diff` and applied with `migrate deploy`, because this execution
surface rejects interactive `migrate dev` when it warns about the new unique index. The SQL was reviewed before applying.

Manual payments use a provisional 24-hour reservation window, matching existing transfer rules. Optionally configure
`Setting` key `reservation.manualHours` with a JSON integer 1–168. No seed rerun is required. The API runs expiration every
minute; `orders.expiryJob` records its health, visible as an admin warning. Guest tracking uses a private fragment link;
there are no emails, carrier tracking, invoices, refunds, current-account charges or external payment calls.

## 2026-10-05 — Checkout preparation

Restart the API after pulling so `/cart/checkout` and `/cart/checkout/preview` are available. No new dependencies,
environment variables or migrations. The frontend doctor probes `/cart/checkout`.

This stage validates contact details and delivery and calculates a review. It does not create orders, reserve stock
or initiate payment. Missing local-delivery tariffs and carrier integration are explicitly unavailable.

## 2026-10-05 — Guest and user cart

Restart the API after pulling so `/cart` is available. No new dependencies, environment variables or migrations:
the cart uses the existing `Cart` and `CartItem` models. See `docs/endpoints.md` for the browser-only contract.

## 2026-10-03 — Public catalog (LumarSoft/api-gc#3)

1. Add to `.env` (values in `.env.example`):
   ```bash
   STORAGE_DIR=storage
   PUBLIC_FILES_URL=http://localhost:3001/files
   ```
2. Load the starter catalog (39 Epson products with photos; prices and stock are sample data). Safe to repeat:
   ```bash
   npm run db:seed
   ```

## 2026-10-03 — Authentication (LumarSoft/api-gc#2)

1. `npm install` (new packages: `@nestjs/jwt`, `@nestjs/throttler`, `bcryptjs`, `cookie-parser`).
2. Add to `.env` (values in `.env.example`): `JWT_SECRET`, `JWT_ACCESS_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS`,
   `FRONT_URL`, `COOKIE_DOMAIN`, `COOKIE_SECURE`, `TRUST_PROXY`. Generate the secret with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
3. Optional — create your admin user:
   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='YourPass123' npm run admin:create
   ```

## 2026-10-03 — Database schema (LumarSoft/api-gc#1)

The schema moved to `prisma/schema/` (one file per domain) with the first migration:

```bash
npx prisma migrate dev && npx prisma generate
```
