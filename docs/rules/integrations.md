# Integration Rules

Applies to every external provider: Tango, Mercado Pago, shipping carriers/aggregators, AI models, email.

## Structure

- Each provider lives in its own module (`src/tango/`, `src/mercado-pago/`, `src/shipping/`, `src/assistant/`…).
- Feature modules depend on a **TypeScript interface + injection token** defined by the integration module, never on
  the provider's SDK, URLs or response shapes.
- Map provider responses to our own types at the boundary. Provider types never leak into other modules.
- Credentials and base URLs come only from environment variables (document them in `.env.example`).
- Every outbound call has a timeout and logs failures with enough context to debug (never with secrets).

## Tango

- **The integration method is not defined yet** (API, e-commerce module, file import/export or another authorized
  alternative). Do not invent Tango endpoints, tables or file formats.
- Until it is defined, implement the interface with a mock/manual adapter and leave a `TODO(tango):` describing what
  is missing.
- Every operation sent to Tango (orders, invoicing data) must be able to fail and be retried: persist a sync status
  (`PENDING`, `SYNCED`, `FAILED`) and the last error. Failed syncs show up in the admin panel.
- A Tango outage must never block a sale: the order is confirmed and the sync is retried later.

## Mercado Pago

- Webhooks are **verified** (signature) and **idempotent**: store the notification/payment id and never process it
  twice.
- Respond to webhooks fast (2xx) and process the event asynchronously if work is heavy.
- The real payment status is always fetched from the Mercado Pago API. Never trust the redirect query string or the
  frontend.
- Amounts sent to Mercado Pago are computed by the backend from the order.

## AI assistant and configurator

- Provider, model and limits come from environment variables.
- The assistant answers only from our data (products, specs, FAQ, documents). It never invents prices, stock or
  policies — it reads them from the database at answer time.
- Unanswered questions are stored so admins can add missing information.
- Escalate to a human only when the assistant cannot resolve the request.
- Usage (conversations, tokens) is tracked — the monthly service fee includes a capped number of conversations.

## Email

- Transactional emails (order confirmation, invoice, payment reminders) go through a single mail module.
- Without credentials in development, emails are logged instead of sent.
