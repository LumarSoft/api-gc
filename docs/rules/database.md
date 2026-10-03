# Database Rules

## Prisma queries

- All Prisma queries go in the service layer — never in controllers or guards.
- Always use `select` or manually exclude sensitive fields when returning data to the client.
  Never return a full row that contains fields like `password`, `token`, or any secret.
- Prefer explicit field selection over `omit` for clarity.
- Operations that write to more than one table go in `prisma.$transaction`.
- Paginate every list endpoint — never return an unbounded `findMany` to the client.

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
- Commit the migration folder together with the `schema.prisma` change.
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
