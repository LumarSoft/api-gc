# Business Rules

Domain rules that apply across modules. When a request contradicts one of these, ask before implementing.

## Money

- Money is **never** a `Float`/`number` stored as-is. In the schema: `Decimal @db.Decimal(12, 2)`. Exchange rates:
  `Decimal @db.Decimal(12, 4)`.
- Every amount is stored together with its currency (`ARS` | `USD` enum).
- Do arithmetic with `Prisma.Decimal`, never with JS numbers. Round only when persisting or displaying.
- `Decimal` values are serialized to the client as strings (`"1234.50"`).
- The backend computes every price, discount, shipping cost and total. **Never trust amounts sent by the client.**

## Buyer profiles

- `RETAIL`: any registered customer.
- `WHOLESALE`: a company whose sign-up application (CUIT, legal name, tax status, addresses, documents) was
  **approved** by an admin. Application states: `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`.
- A wholesaler that is `PENDING` or `PAUSED` buys as `RETAIL` (retail prices, no current account).
- The buyer profile is **derived**: `User.role` is only `CUSTOMER` or `ADMIN`; a customer is `WHOLESALE` when their
  company's `wholesaleStatus` is `APPROVED`. Never store the profile on the user.
- Wholesalers buy directly with the wholesale price list — individual orders do not need approval.

## Orders

- An order line stores a **snapshot** of product name, unit price and currency at purchase time. An order is never
  recalculated with current prices.
- Order state changes go through a single service method that validates the transition.
- Orders are never deleted — they are cancelled.

## Stock

- Stock is reserved when checkout starts. Reservations expire: payment window for Mercado Pago, **24 hours** for
  pending bank transfers.
- Expired or cancelled orders release their reservation automatically (scheduled job).
- Every stock change is a row in a movements table (product, quantity, reason, reference). Never overwrite a stock
  number without recording the movement.
- Reserving stock and creating the order happen in the same `prisma.$transaction`.

## Wholesale current account

- Every debit (purchase) and credit (payment, adjustment) is a ledger row with amount, currency, due date (debits)
  and reference. The balance is derived from the ledger or updated in the same transaction as the row.
- Partial payments are allowed. A payment can be applied to one or more debits.
- Initial balances will be imported from Excel — imports also create ledger rows.

## Shipping

- In-store pickup is always free.
- Rosario delivery: configurable flat rate and configurable minimum order amount for free shipping.
- Rest of the country: quoted by postal code, weight and dimensions through an external provider.
- Shipping rules and thresholds are configuration stored in the database, not constants in code.

## Products

- Products can come from Tango or be created manually. Price can come from Tango or be set manually.
- Out-of-stock behavior is configurable per product: show, hide, or allow inquiry.
- Weight and dimensions may be missing in Tango and completed from the admin panel.
- A product is created as a **draft** with one default variant. It can be **published** only when at least one active
  variant has a price in the default retail list; a product without images can be published (the admin sees a
  warning). Agreed on 2026-10-04 as a starting point; revisit with the client.
- **Duplicating** a product creates a draft copy with new slug and SKUs (`-copia` / `-COPIA`). Tango codes and stock
  are never copied: they belong to the original articles.
