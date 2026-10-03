# Naming Conventions

## Language

- Everything in English: file names, variables, classes, methods, comments, schema models and fields.
- Domain terms without a clean English equivalent keep a single agreed translation — use this glossary:

| Spanish (business)             | Code                    |
| ------------------------------ | ----------------------- |
| Consumidor final / minorista   | `retail`                |
| Mayorista                      | `wholesale`             |
| Alta de empresa (solicitud)    | `WholesaleApplication`  |
| Cuenta corriente               | `CurrentAccount`        |
| Movimiento de cuenta corriente | `AccountMovement`       |
| Comprobante de transferencia   | `TransferReceipt`       |
| Cotización (tipo de cambio)    | `ExchangeRate`          |
| Cotización de envío            | `ShippingQuote`         |
| Retiro en tienda               | `StorePickup`           |
| Reserva de stock               | `StockReservation`      |
| Razón social                   | `legalName`             |
| Condición fiscal (IVA)         | `taxCondition`          |
| Factura                        | `Invoice`               |
| Configurador                   | `Configurator`          |
| Lista de precios               | `PriceList`             |
| Combo                          | `Bundle` / `BundleItem` |
| Consulta por producto          | `ProductInquiry`        |
| Botón de arrepentimiento       | `WithdrawalRequest`     |
| Comprobante fiscal             | `Invoice`               |

User-facing copy says **"clientes frecuentes"**, never "mayorista"; the code keeps `wholesale`.

Add new terms to this table instead of inventing a different translation.

## Files

- `kebab-case` for all files:
  - `products.service.ts`
  - `jwt-auth.guard.ts`
  - `create-product.dto.ts`

## Classes

- `PascalCase`:
  - `ProductsService`
  - `JwtAuthGuard`
  - `CreateProductDto`
  - `PrismaService`

## Variables and methods

- `camelCase`:
  - `findProductById`
  - `hashedPassword`
  - `accessToken`

## DTOs

- Always include the `Dto` suffix.
- Prefix with action for input DTOs: `CreateProductDto`, `UpdateProductDto`, `LoginDto`
- Prefix with resource for output DTOs: `ProductResponseDto`

## Modules and folders

- One folder per feature module, named in `kebab-case` plural:
  - `src/auth/`
  - `src/products/`
  - `src/wholesale-applications/`

## Routes

- Plural, `kebab-case`: `/products`, `/wholesale-applications/:id/approve`.

## Constants and enums

- Constants: `UPPER_SNAKE_CASE`
- Enum values: `UPPER_SNAKE_CASE`

```typescript
export enum ProductStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  HIDDEN = 'HIDDEN',
}
```
