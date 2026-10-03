# Security Rules

## Passwords

- Always hash passwords with bcrypt before persisting. Never store plain text passwords.
- Use a salt rounds value of 10 minimum.
- Never log, return, or expose password fields in any response.

## Tokens and secrets

- Never hardcode secrets, API keys, or connection strings in the codebase.
- All sensitive configuration must live in environment variables (`.env`).
- Never commit `.env` files — ensure `.env` is in `.gitignore`.
- JWT secret must come from `JWT_SECRET`.

## Route protection

- Every route that requires authentication must declare its guard explicitly (`@UseGuards(JwtAuthGuard)`).
- Never assume a route is protected — always declare the guard.
- Public routes (catalog, login, register, webhooks) must remain unguarded intentionally.
- Role checks are explicit: `ADMIN` by `User.role`; `WHOLESALE` (approved company only) by the derived buyer profile
  (see `business-rules.md`); everything else is `RETAIL`. A user can only read and modify their own
  orders, addresses and account statement.

## Payments and money

- Never trust prices, totals, discounts, roles or payment status sent by the client.
- Payment webhooks are verified (signature) and idempotent — see `integrations.md`.
- Never log card data, full webhook payloads or payment provider tokens.

## Uploads

- Uploaded documents (wholesale application documents, transfer receipts) are private: validate type and size, store
  outside the public folder, and serve them only to the owner and admins.

## Logging

- Never log passwords, tokens, or any sensitive user data.
- Never use `console.log` in production code — use Nest's `Logger`. ESLint enforces `no-console`.

## General

- Always validate and sanitize input via DTOs before processing.
- Never expose internal implementation details in error messages returned to the client.
