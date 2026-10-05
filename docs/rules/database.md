# Database Rules

## Prisma queries

- All Prisma queries go in the service layer — never in controllers or guards.
- Always use `select` or manually exclude sensitive fields when returning data to the client.
  Never return a full row that contains fields like `password`, `token`, or any secret.
- Prefer explicit field selection over `omit` for clarity.
- Operations that write to more than one table go in `prisma.$transaction`.
- Paginate every list endpoint — never return an unbounded `findMany` to the client.
  `GET /cart` returns one owned aggregate with its complete lines, rather than a collection of carts; its lines are
  intentionally not paginated so the subtotal and issue flags describe the whole selection.

## Example — excluding sensitive fields

```typescript
// Wrong — exposes password
return this.prisma.user.findUnique({ where: { id } })

// Correct — explicit select
return this.prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, createdAt: true },
})
```

## Migrations

- Always run migrations with a descriptive name:

```bash
npx prisma migrate dev --name add-wholesale-application
```

- Never modify an already-applied migration — always create a new one.
- Commit the migration folder together with the `prisma/schema/*.prisma` change.
- Run `npx prisma generate` after every schema change **and after pulling new migrations**. Since Prisma 7,
  `migrate dev` no longer regenerates the client — skipping this leaves the code with stale types.
- Never edit the `_prisma_migrations` table manually.
- Never run `prisma db push` or `prisma migrate reset` against a database that is not your local one.

## Schema

- Every model must have a primary key: `id Int @id @default(autoincrement())`.
- Models in `PascalCase` singular English (`Product`, `OrderItem`); fields in `camelCase`.
- Use `@default(now())` for `createdAt` and `@updatedAt` for `updatedAt`.
- Every model must include a `deletedAt DateTime?` field for soft deletes — never use hard deletes.
- Foreign keys must have explicit `@relation` annotations and an `@@index`.
- Money: `Decimal @db.Decimal(12, 2)`, never `Float`. See `business-rules.md`.
- Fixed sets of values are Prisma `enum`s (`UPPER_SNAKE_CASE` values), not free strings.
- Strings with a known max length use `@db.VarChar(n)`; long text uses `@db.Text`.
- Document non-obvious fields with `///` comments in the schema (why the field exists, units, allowed shapes for
  `Json`).
- Keep the schema as the single source of truth for the database structure.
- The schema is split by domain in `prisma/schema/` (one `.prisma` file per domain, see `docs/database.md`). Put a
  new model in the file of its domain; create a new file only for a new domain and list it in `schema.prisma`.

## Only model what is used now

- **A new table or column is added only in the same PR as the code that uses it** (a service, endpoint or job that
  reads or writes it). No tables, columns or enum values "for later" or "just in case".
- If a feature is planned but not being built, it stays in the proposal or an issue — not in the schema.
- The schema created on 2026-10-03 includes models that no code uses yet (cart, orders, payments, shipping, current
  account, assistant, configurator, CRM…). Treat them as **provisional**: before building on one, check it against
  the real requirement and change, rename or drop it in the same PR. Do not add new models next to them in advance.
- How to tell if a model is used: search for `prisma.<model>` / `tx.<model>` in `src/` (excluding `src/generated/`).

## Soft deletes

- Never use `delete` or `deleteMany` in Prisma — always set `deletedAt` to the current timestamp.
- All queries that list or fetch records must filter `deletedAt: null` to exclude soft-deleted rows.
- Unique constraints that could conflict with soft-deleted rows must account for this (e.g. deactivate before
  re-creating, or use composite uniqueness).

```typescript
// Wrong — hard delete
await this.prisma.product.delete({ where: { id } })

// Correct — soft delete
await this.prisma.product.update({
  where: { id },
  data: { deletedAt: new Date() },
})

// Correct — exclude soft-deleted rows in queries
await this.prisma.product.findMany({
  where: { deletedAt: null },
})
```

Any exception to soft delete must be justified and documented in this file.

### Documented exceptions

These models have **no `deletedAt`** on purpose (and append-only ones have no `updatedAt` either):

| Kind                         | Models                                                                                                                                          | Why                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Append-only ledgers and logs | `StockMovement`, `ExchangeRate`, `CouponRedemption`, `OrderStatusHistory`, `PaymentAllocation`, `AssistantMessage`, `ActivityEvent`, `AuditLog` | They record what happened. Rows are never edited or deleted; a mistake is corrected with a new row.                   |
| Financial and fiscal records | `Order`, `OrderItem`, `OrderAddress`, `Payment`, `Invoice`, `AccountMovement`                                                                   | Never deleted by business/legal rule: orders are cancelled, payments are refunded, ledger errors get an `ADJUSTMENT`. |
| Operational logs             | `PaymentNotification`, `ShippingQuote`, `ExternalSync`, `EmailMessage`                                                                          | Technical state; old rows may be purged by a maintenance job, never soft-deleted.                                     |
| Pure join tables             | `ProductTag`, `BundleItem`, `ProductCompatibility`, `PromotionTarget`, `Favorite`, `ConfiguratorOptionTag`                                      | Only link two rows. Removing the link is a real delete so their `@@unique` keeps working.                             |

### Unique fields on soft-deletable models

`email`, `slug`, `sku`, `code`, `cuit`, `tangoCode`… are `@unique`, and a soft-deleted row still holds its value.
When creating a record whose unique value already belongs to a soft-deleted row, **restore and update that row**
(`deletedAt: null`) instead of inserting a new one. This keeps the history linked (orders, movements) and never breaks
the constraint.

Exception: **products** are not restored this way, because the archived row still owns its variants, photos and
specifications. A new product gets a numbered slug (`epson-l3250-2`) and a slug or SKU typed by the admin must be free
(`409` otherwise).
