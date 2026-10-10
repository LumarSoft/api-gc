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
  `ShippingMethod`; its destination must be Rosario, Santa Fe. Carrier delivery (rest of the country) is described in
  "Shipping" below.

- **Current scope (requested 2026-10-05):** guest completion is enabled; no email or Tango integrations are
  activated (carrier shipping: see "Shipping"; online payment: see "Online payment" below). Orders paid at the store use
  `MANUAL` payment, pending until an admin explicitly verifies receipt of the
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
- A signed-in buyer also sees their orders in the account area (`GET /orders/mine`), owned by `Order.userId` only.
  Guest orders are never attached to an account by email, before or after sign-up: the typed checkout email does not
  prove ownership. Wholesale company members see only the orders they placed.
- A review fingerprint detects changed product names, quantities, ARS prices, contact data, destination or delivery cost.
  A changed review returns 409 and requires review again. The fingerprint is not authorization and no client total is trusted.
- **Provisional implementation choice:** pending manual-payment reservations use the existing 24-hour transfer window.
  `Setting.reservation.manualHours` can override it with an integer 1–168; absent, archived or invalid values use 24.
  Staff edit it in the admin (`/admin/settings/reservation`).
  Checkout shows this window before confirmation and tracking shows the precise expiration. Revisit with the client
  when their offline payment process is finalized.
- Pending orders may be cancelled; confirmed orders advance to preparation, then ready for pickup (pickup) or shipped
  (local delivery), then delivered. Carrier orders are prepared by staff but shipped and delivered **only by the
  carrier** (agreed 2026-10-09): they advance on their own when the carrier reports the parcel handed over or
  delivered (webhook, or "Actualizar" in the admin), so an order never shows delivered while its parcel is at the store. Paid cancellation/refunds are not enabled in this stage. Expired/cancelled/delivered
  states are terminal. Staff notes and actor ids stay out of guest tracking.

- An order line stores a **snapshot** of product name, unit price and currency at purchase time. An order is never
  recalculated with current prices.
- Order state changes go through `OrderStatusService`, which validates every transition (staff changes, reservation
  expiry, carrier updates and Mercado Pago payments).
- Orders are never deleted — they are cancelled.

## Online payment

- **Mercado Pago Checkout Pro (added 2026-10-10)**, offered at checkout next to paying at the store ("Pago a coordinar
  con el local", which stays). It is off until its access token is in the environment.
- A Mercado Pago order is created like any other (`PENDING_PAYMENT`, stock reserved) and the buyer is sent to Mercado
  Pago's checkout for the order total computed by the backend (products and delivery, from the order snapshot). Each
  attempt creates a new checkout, so a rejected card is retried from the order page.
- **Reservation (provisional, revisit with the client): one hour** for Mercado Pago orders, instead of the manual
  window. The checkout stops taking payments 10 minutes before it ends, so the approval reaches us while the stock is
  still held. Payments are approved or rejected at once (Mercado Pago's binary mode): no cash vouchers (Rapipago, Pago
  Fácil) or manual reviews that resolve days later.
- The payment status is always read from Mercado Pago's API: by the signed webhook, and when the buyer comes back to
  the store (which covers a late or missing webhook). Never from the redirect or the browser.
- An approved payment confirms the order only when it was approved before the reservation deadline, for the exact
  total in ARS, while the order still waits for payment. It records the `Payment` (Mercado Pago operation id, status,
  installments), consumes the reservation and leaves a history note. A rejected payment keeps the order pending until
  the reservation expires. An approved payment that does not pay the order (late, a second one, another amount) is
  kept and flagged to staff to refund from Mercado Pago; refunds are not automated yet.
- Staff can still mark a Mercado Pago order as paid by hand (e.g. the buyer paid at the store).

## Stock

- Stock is reserved when checkout starts. Reservations expire: one hour for Mercado Pago (see "Online payment"),
  **24 hours** for pending bank transfers; current manual orders use the provisional configured window above.
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
- **Carrier provider (agreed 2026-10-09): Zipnova**, which quotes and books Correo Argentino, OCA and other carriers
  with its own negotiated rates (no carrier contracts needed). It is off until its credentials are in the environment.
- The buyer quotes a destination (postal code, city, province) and sees the best option per delivery mode, as Zipnova
  ranks them with the account's selection setting (price by default): home delivery and branch pickup, one choice per
  branch. The price shown is Zipnova's buyer price with VAT and insurance; no free-shipping threshold applies to the
  carrier yet. A quote lasts 30 minutes and only for the quoted cart lines and destination.
- Carrier delivery needs the recipient's DNI or CUIT (check digit validated) and a phone (carriers require them).
- **No "envío a coordinar" (agreed 2026-10-09):** every product is quoted by weight and measurements, large equipment
  included (Zipnova picks carriers that take large parcels). Up to 1,000 units per order (technical bound of the
  per-unit quote). Weight and measurements are required to publish (see Products), so only products published before
  that rule can lack them: the carrier option then says pickup is available, and the admin lists them to complete.
- When the Zipnova account has no balance, a booked shipment stays "Procesando" without a label. The admin refuses to
  book with that explanation, and says so too if a label is requested for a shipment stuck that way.
- The order keeps the chosen option on a pending `Shipment`. Staff book it at Zipnova from the order once it is paid
  (it is charged to the Zipnova balance), print the label (PDF or ZPL) and the dispatch guide, and can cancel it before
  dispatch and book it again. Zipnova's webhook then updates the shipment and moves the order to shipped and delivered on its own.
  Returns, losses and cancellations do not change the order: staff decide what to do.
- Zipnova emails the buyer the tracking link (its account setting), so the store does not need its own email for it.
- Labels describe each item by its **SKU**, not its name (agreed 2026-10-09): staff still recognize it, and the box does
  not announce an expensive printer to everyone who handles it. A package with several units shows "N productos"
  (Zipnova's own wording).

## Products

- Products can come from Tango or be created manually. Price can come from Tango or be set manually.
- Out-of-stock behavior is configurable per product: show, hide, or allow inquiry.
- Weight and dimensions may be missing in Tango and completed from the admin panel ("Sin peso o medidas" filter).
- A product is created as a **draft** with one default variant. It can be **published** only when at least one active
  variant has a price in the default retail list and **every active variant has weight and the three measurements**
  (added 2026-10-09, so every published product can be shipped); a product without images can be published (the admin
  sees a warning). A published product cannot get an active variant without them. Agreed on 2026-10-04 as a starting
  point; revisit with the client.
- Prices are set per variant and price list (retail, "clientes frecuentes"), each in ARS or USD. A price edited in the
  panel becomes `MANUAL`. USD prices are shown and charged in ARS at the exchange rate in effect.
- The USD exchange rate history is append-only: a new rate can start now or later, never in the past.
- A product keeps at least one variant; the default variant is always an active one.
- A product is an **offer** when its lowest price for the current buyer is below that variant's previous price
  (`compareAtAmount`). The `OFFER` badge and `GET /products?onSale=true` ("Ofertas") use the same rule, so a
  frequent customer may see different offers than a retail visitor.
- **Duplicating** a product creates a draft copy with new slug and SKUs (`-copia` / `-COPIA`). Tango codes and stock
  are never copied: they belong to the original articles.

## Activity tracking

- **Agreed 2026-10-08:** the store records anonymous activity for the stats page (visits, product views, searches,
  add to cart, checkout started, order placed). First party only: no Google Analytics or other third parties.
- A visitor is a random UUID the browser keeps (`localStorage`). It is never linked to an account, and no IP, email or
  free-form data is stored. Admins are not tracked, and browsers that send Global Privacy Control or Do Not Track are
  not tracked either.
- Events come from the browser: blockers, disabled JavaScript and crawlers (filtered by user agent) make the numbers
  a lower bound. Distinct visitors are counted, so reloading a page does not inflate views.
- A cart with products, never ordered and untouched for **24 hours** counts as abandoned (stats definition, not a
  status change: there is no abandoned-cart job or email yet).
- No retention limit yet: events are append-only. Revisit (purge or aggregate old events) if the table grows large.

## Favorites

- Only signed-in customers save favorites (the `Favorite` row needs a user); guests are asked to sign in. Favorites are
  private and survive across devices. Saving and removing are idempotent; removing is a real delete (join table).
- The list shows each product with the buyer's current price and stock; products that stop being visible are hidden,
  not deleted, so they return if published again. At most 200 per account (technical bound, not a client policy).
