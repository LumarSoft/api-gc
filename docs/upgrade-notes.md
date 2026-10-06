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

## 2026-10-05 — Linux deployment behind Nginx

1. Add `HOST=0.0.0.0` to development environments. On the Linux server use `HOST=127.0.0.1`,
   `PORT=3005`, `TRUST_PROXY=1`, `COOKIE_SECURE=true` and an empty `COOKIE_DOMAIN`.
2. Keep images in persistent storage (`STORAGE_DIR=/var/lib/api-gc/storage`) and set
   `PUBLIC_FILES_URL=https://api-cg.lumarsoft.com/files`. Copy the seed image files into
   `storage/public/products`; do not reseed a production catalog just to restore images.
3. The Vercel frontend proxies `/api/*` to this API. Nginx must use
   `proxy_cookie_path /auth /api/auth;` so refresh cookies reach the browser's proxied auth endpoints.
4. This server has 1 GB RAM. Build on a machine with enough memory and copy `dist/` from the same commit;
   install dependencies and generate Prisma on Linux. Run with PM2 on port 3005, save its process list,
   and keep the PM2 startup service enabled. Keep `.env` and persistent storage outside the build archive.
5. Certbot renews the certificate automatically. Its deployment hook reloads Nginx after renewal.
   `npm run doctor` supports absolute `STORAGE_DIR` paths and checks that product images are present.

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
