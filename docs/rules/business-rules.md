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
- **Applying** (implemented 2026-10-06): a signed-in customer sends legal name, CUIT (check digit validated), tax
  condition (responsable inscripto, monotributista or exento — a final consumer buys as retail), company email and
  phone, plus an optional message. One company per customer; a CUIT already registered by another account is refused
  without revealing it (the store adds members by hand for now). A rejected customer can correct the data and apply
  again; pending, approved or paused customers cannot.
- **Review**: staff approve or reject a pending application, and pause or resume an approved account. Rejecting and
  pausing require a reason, which the customer sees. Every decision is audited and takes effect on the next request
  (prices are re-resolved per request). Approve/reject emails are recorded (no provider yet).
- **Documents** (AFIP certificate, etc.) are not requested yet: they need private storage, not the public `/files`.

## Cart

- Guests may use a cart without registering. An opaque httpOnly cookie identifies it; only the token hash is stored.
  The cookie lasts 30 days. User carts are loaded by authenticated user id and survive logout and other devices.
- On the first browser cart request after login, the guest cart is claimed or merged with the user's active cart.
  Quantities of the same variant are added, and prices are recalculated for the current buyer. The guest token is
  invalidated; a merge happens once. Cart and owner locks serialize concurrent changes.
- Request quantities are positive integers, at most 1,000,000 (technical input bound). A merge is capped at that
  quantity per variant. This is not a client purchase-limit policy.
- Adding/increasing a line requires a published active variant, an ARS-resolvable price and sufficient available
  stock. Adding to a cart does **not** reserve stock; reservation belongs to checkout.
- Existing lines that lose price, publication or stock remain visible with an issue so the buyer can reduce or remove
  them. A merge preserves lines even when their combined quantity exceeds current stock and reports the issue.
- Cart subtotals use current prices through `PricingService`, exclude shipping, and are not order snapshots. If any
  line cannot be priced in ARS, subtotal is null (never a partial sum). Coupons are not implemented yet; checkout confirms immutable orders.

## Orders

- Checkout preparation (`/cart/checkout`, `/cart/checkout/preview`) is available to the current cart owner, including
  guests. It validates contact details and recalculates the cart plus delivery with decimal arithmetic. It does not
  persist contact/address data, create an order, reserve stock or initiate payment. Confirmation is a separate request that checks current prices/stock again and atomically creates the order and reservation.
- Pickup is free. Preview offers local delivery only with an active ARS flat rate and nonnegative threshold in
  `ShippingMethod`; its destination must be Rosario, Santa Fe. Carrier quotes remain unavailable until an adapter exists.

- **Current scope (requested 2026-10-05):** guest completion is enabled; no external payment, email, carrier or Tango
  integrations are activated. Orders use `MANUAL` payment, pending until an admin explicitly verifies receipt of the
  full amount. Confirmation records an approved manual `Payment`, consumes the reservation and records stock sale
  movements and an audit entry. This does not move money, issue an invoice or charge a wholesale current account.
- `Order.userId` is nullable. A guest never gets a synthetic account. A cryptographically random 256-bit browser token
  identifies the checkout attempt and grants private tracking; only its SHA-256 hash is stored. Retries with the same
  token return the existing order, even if its cart has been converted. The browser persists a pending attempt token
  in session storage and can recover a lost response. Sharing this token shares access to the order's contact data.
- The tracking link carries the token in the URL fragment. The front sends it in a POST body; never in query strings,
  server-rendered pages, analytics or logs. The number/email alone cannot grant access. No automatic emails in this
  stage: the buyer must copy/bookmark the private link shown after confirmation. Lost-link recovery by identity checks
  and token rotation remains a future support workflow; no insecure public email/number lookup is exposed.
- A review fingerprint detects changed product names, quantities, ARS prices, contact data, destination or delivery cost.
  A changed review returns 409 and requires review again. The fingerprint is not authorization and no client total is trusted.
- **Provisional implementation choice:** pending manual-payment reservations use the existing 24-hour transfer window.
  `Setting.reservation.manualHours` can override it with an integer 1–168; absent, archived or invalid values use 24.
  Staff edit it in the admin (`/admin/settings/reservation`).
  Checkout shows this window before confirmation and tracking shows the precise expiration. Revisit with the client
  when their offline payment process is finalized.
- Pending orders may be cancelled; confirmed orders advance to preparation, then ready for pickup (pickup) or shipped
  (local delivery), then delivered. Paid cancellation/refunds are not enabled in this stage. Expired/cancelled/delivered
  states are terminal. Staff notes and actor ids stay out of guest tracking.

- An order line stores a **snapshot** of product name, unit price and currency at purchase time. An order is never
  recalculated with current prices.
- Order state changes go through a single service method that validates the transition.
- Orders are never deleted — they are cancelled.

## Stock

- Stock is reserved when checkout starts. Reservations expire: payment window for Mercado Pago, **24 hours** for
  pending bank transfers; current manual orders use the provisional configured window above.
- Cancellation releases stock in the transition transaction. The local expiration job runs every minute, up to 100
  overdue orders per pass, with order locks and idempotent ledger writes. Multiple API instances may run it safely.
  No payment may be confirmed after the deadline, even before the job runs. Job failures are logged without secrets and
  persisted in `Setting.orders.expiryJob` (`{ failed: boolean, lastRunAt: ISO string }`); admin lists also flag reservations
  overdue by more than two minutes, covering an unavailable job/database. No external scheduler is required.
- Every stock change is a row in a movements table (product, quantity, reason, reference). Never overwrite a stock
  number without recording the movement.
- **Provisional (agreed 2026-10-04):** until the Tango integration exists, admins can set the counted stock of a
  variant from the panel (`ADJUSTMENT` movement, `StockService`, `TODO(tango)`). This is a stopgap: the real source of
  stock is Tango, and the sync still has to be built. The panel shows a notice saying so.
- Reserving stock and creating the order happen in the same `prisma.$transaction`.

## Wholesale current account

- Every debit (purchase) and credit (payment, adjustment) is a ledger row with amount, currency, due date (debits)
  and reference. The balance is derived from the ledger or updated in the same transaction as the row.
- Partial payments are allowed. A payment can be applied to one or more debits.
- Initial balances will be imported from Excel — imports also create ledger rows.

## Shipping

- In-store pickup is always free.
- Rosario delivery: configurable flat rate and configurable minimum order amount for free shipping. Staff set both, and turn it
  on or off, in the admin (`/admin/settings/local-delivery`); turning it on requires a rate, and a free-shipping amount
  must be above zero.
- Rest of the country: quoted by postal code, weight and dimensions through an external provider.
- Shipping rules and thresholds are configuration stored in the database, not constants in code.

## Products

- Products can come from Tango or be created manually. Price can come from Tango or be set manually.
- Out-of-stock behavior is configurable per product: show, hide, or allow inquiry.
- Weight and dimensions may be missing in Tango and completed from the admin panel.
- A product is created as a **draft** with one default variant. It can be **published** only when at least one active
  variant has a price in the default retail list; a product without images can be published (the admin sees a
  warning). Agreed on 2026-10-04 as a starting point; revisit with the client.
- Prices are set per variant and price list (retail, "clientes frecuentes"), each in ARS or USD. A price edited in the
  panel becomes `MANUAL`. USD prices are shown and charged in ARS at the exchange rate in effect.
- The USD exchange rate history is append-only: a new rate can start now or later, never in the past.
- A product keeps at least one variant; the default variant is always an active one.
- A product is an **offer** when its lowest price for the current buyer is below that variant's previous price
  (`compareAtAmount`). The `OFFER` badge and `GET /products?onSale=true` ("Ofertas") use the same rule, so a
  frequent customer may see different offers than a retail visitor.
- **Duplicating** a product creates a draft copy with new slug and SKUs (`-copia` / `-COPIA`). Tango codes and stock
  are never copied: they belong to the original articles.

## Favorites

- Only signed-in customers save favorites (the `Favorite` row needs a user); guests are asked to sign in. Favorites are
  private and survive across devices. Saving and removing are idempotent; removing is a real delete (join table).
- The list shows each product with the buyer's current price and stock; products that stop being visible are hidden,
  not deleted, so they return if published again. At most 200 per account (technical bound, not a client policy).
