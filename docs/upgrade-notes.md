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
