# Architecture Rules

## Module structure

- Every feature lives in its own NestJS module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.
- One module per business resource. Never mix responsibilities in the same service.
- Every module must be imported in `AppModule` or in a parent module — never leave orphaned modules.
- Shared, non-feature code (helpers, decorators, guards used everywhere) goes in `src/common/`.
- External providers (Tango, Mercado Pago, shipping, AI) get their own module — see `integrations.md`.

## Controller rules

- Controllers only receive requests, delegate to the service, and return the response.
- No business logic in controllers.
- No direct Prisma queries in controllers.
- Always use DTOs for `@Body()`, `@Param()`, and `@Query()`.

## Service rules

- Business logic lives in the service layer: the service plus its `lib/` rules and mapper (see below), never in controllers.
- Services are the only layer that calls `PrismaService`.
- One service per module — do not inject one feature's service into another unless strictly necessary.
  If shared logic is needed, extract it into a dedicated shared module.
- Every service method has an explicit return type.

## Size and responsibility

- No god services. A service **orchestrates** a use case; around 250 lines is a signal to split it.
- Move the parts that are not orchestration out of the service, inside the same module:
  - `lib/<thing>-selects.ts` — Prisma `select`/`include` shapes and the row types inferred from them.
  - `lib/<thing>-rules.ts` — pure business rules (no Nest, no Prisma): easy to unit test.
  - `<thing>.mapper.ts` — an `@Injectable()` that turns rows into response DTOs (prices, URLs, labels).
- Reference: `src/products/` (service + `product.mapper.ts` + `lib/`).

## PrismaService

- `PrismaService` is the single point of access to the database across the entire app.
- Never instantiate `PrismaClient` directly outside of `PrismaService`.
- `PrismaModule` is global — no need to import it in every module.

## Configuration

- Read configuration through `ConfigService` (or `process.env` only in `main.ts` / `PrismaService` bootstrap code).
- Every new environment variable is added to `.env.example` with a comment explaining it.

## General

- Keep methods small and focused on a single responsibility.
- Avoid logic duplication — extract shared logic into helpers or shared services.
- Keep logic as simple as possible. Avoid over-engineering.
- Use the Nest CLI to scaffold (`npx nest g resource <name> --no-spec` or `npx nest g module|controller|service`)
  so files follow the standard layout.
