# API Endpoints

Every endpoint must be documented here in the same commit that introduces it. Format: `docs/rules/documentation.md`.

## Health

### GET /health

Checks that the API is up and the database is reachable.

**Auth required:** No

**Responses**

`200 OK`

```json
{ "status": "ok", "database": "up" }
```

`503 Service Unavailable`

```json
{ "statusCode": 503, "message": "Database is not reachable", "error": "Service Unavailable" }
```

## Auth

Sessions use two **httpOnly cookies** set by the API; the front never reads or stores tokens:

| Cookie  | Content                                      | Path    | Lifetime                          |
| ------- | -------------------------------------------- | ------- | --------------------------------- |
| `cg_at` | Access token (JWT)                           | `/`     | `JWT_ACCESS_TTL_MINUTES` (15 min) |
| `cg_rt` | Refresh token (opaque, rotated on every use) | `/auth` | `REFRESH_TOKEN_TTL_DAYS` (30 d)   |

Requests from the browser must use `credentials: 'include'`. When a protected endpoint answers `401`, call
`POST /auth/refresh` once and retry. Tools and tests may send the access token as `Authorization: Bearer <jwt>`.

Rate limit: 100 requests/min per IP on every route; **5/min** on `register`, `login`, `forgot-password`,
`reset-password` and `resend-verification` (`429 Too Many Requests`).

`AuthUser` (returned by several endpoints):

```json
{
  "id": 1,
  "email": "ana@example.com",
  "firstName": "Ana",
  "lastName": "Pérez",
  "phone": null,
  "role": "CUSTOMER",
  "buyerType": "RETAIL",
  "emailVerified": false,
  "company": null
}
```

`role`: `CUSTOMER` | `ADMIN`. `buyerType`: `RETAIL` | `WHOLESALE` (derived: `WHOLESALE` only when `company.wholesaleStatus`
is `APPROVED`). `company`: `{ "id": 3, "legalName": "Imprenta SA", "wholesaleStatus": "PENDING" }` or `null`.

### POST /auth/register

Creates a customer account, starts a session (sets the cookies) and sends the email-verification email.

**Auth required:** No

**Request body**

| Field          | Type    | Required | Constraints                                         |
| -------------- | ------- | -------- | --------------------------------------------------- |
| email          | string  | Yes      | Valid email, max 191. Stored trimmed and lowercase. |
| password       | string  | Yes      | 8–72 chars, at least one letter and one number      |
| firstName      | string  | Yes      | 1–100 chars                                         |
| lastName       | string  | Yes      | 1–100 chars                                         |
| phone          | string  | No       | Max 30 chars                                        |
| marketingOptIn | boolean | No       | Default `false`                                     |

```json
{ "email": "ana@example.com", "password": "clave1234", "firstName": "Ana", "lastName": "Pérez" }
```

**Responses**

`201 Created` — `AuthUser`

`400 Bad Request`

```json
{ "message": ["password must contain at least one letter and one number"], "error": "Bad Request", "statusCode": 400 }
```

`409 Conflict`

```json
{ "message": "An account with this email already exists", "error": "Conflict", "statusCode": 409 }
```

### POST /auth/login

Starts a session (sets the cookies).

**Auth required:** No

**Request body**

| Field    | Type   | Required | Constraints |
| -------- | ------ | -------- | ----------- |
| email    | string | Yes      | Valid email |
| password | string | Yes      | 1–72 chars  |

**Responses**

`200 OK` — `AuthUser`

`401 Unauthorized` — same message for unknown email and wrong password

```json
{ "message": "Invalid email or password", "error": "Unauthorized", "statusCode": 401 }
```

### POST /auth/refresh

Exchanges the `cg_rt` cookie for a new pair of cookies (rotation). Reusing an already-used refresh token revokes every
session of that user, except within 30 seconds of its rotation: that is treated as two tabs refreshing at once, so the
request gets `401` but the cookies are kept (the other tab already stored the new ones). The client should simply retry
its original request.

**Auth required:** No (needs the `cg_rt` cookie)

**Responses**

`200 OK` — `AuthUser`

`401 Unauthorized` — missing, expired, revoked or reused token. Both cookies are cleared.

### POST /auth/logout

Revokes the current refresh token and clears both cookies.

**Auth required:** No

**Responses**

`204 No Content`

### GET /auth/me

Returns the logged-in user.

**Auth required:** Yes (any role)

**Responses**

`200 OK` — `AuthUser`

`401 Unauthorized`

```json
{ "message": "Unauthorized", "statusCode": 401 }
```

### POST /auth/forgot-password

Emails a password-reset link (`{FRONT_URL}/restablecer-contrasena?token=…`, valid 1 hour). Always answers `204`, even
for unknown emails, so it cannot be used to discover accounts.

**Auth required:** No

**Request body**

| Field | Type   | Required | Constraints |
| ----- | ------ | -------- | ----------- |
| email | string | Yes      | Valid email |

**Responses**

`204 No Content`

### POST /auth/reset-password

Sets a new password from a reset link and logs out every device.

**Auth required:** No

**Request body**

| Field    | Type   | Required | Constraints                                    |
| -------- | ------ | -------- | ---------------------------------------------- |
| token    | string | Yes      | Token from the email link                      |
| password | string | Yes      | 8–72 chars, at least one letter and one number |

**Responses**

`204 No Content`

`401 Unauthorized`

```json
{ "message": "Invalid or expired link", "error": "Unauthorized", "statusCode": 401 }
```

### POST /auth/verify-email

Confirms the email from the verification link (`{FRONT_URL}/verificar-email?token=…`, valid 48 hours).

**Auth required:** No

**Request body**

| Field | Type   | Required | Constraints               |
| ----- | ------ | -------- | ------------------------- |
| token | string | Yes      | Token from the email link |

**Responses**

`204 No Content`

`401 Unauthorized` — `"Invalid or expired link"`

### POST /auth/resend-verification

Sends a new verification email. Does nothing if the email is already verified.

**Auth required:** Yes (any role)

**Responses**

`204 No Content`

## Catalog

Public endpoints. `GET /products*` read the session when present (same cookies as Auth) because **prices depend on
the buyer**: anonymous and retail users get the default retail list; approved wholesale customers get their
company's list (or the default wholesale one), falling back to retail for products without a wholesale price.
An **expired or invalid** session cookie gets `401` (not anonymous prices): the client refreshes the session and
retries, exactly like on protected endpoints.

`Money`: `{ "amount": "419999.00", "currency": "ARS" }`. Prices loaded in USD are returned in ARS converted at the
latest exchange rate; if no rate exists yet they are returned in `USD`.

Image URLs point to `PUBLIC_FILES_URL` (`/files/...` on the API by default).

### GET /categories

Store menu: top-level categories with their subcategories.

**Auth required:** No

**Responses**

`200 OK`

```json
[
  {
    "id": 1,
    "name": "Impresoras",
    "slug": "impresoras",
    "description": null,
    "imageUrl": null,
    "parent": null,
    "children": [{ "id": 2, "name": "Para el hogar", "slug": "impresoras-hogar" }]
  }
]
```

### GET /categories/:slug

One category with its parent (for breadcrumbs) and children.

**Auth required:** No

**Responses**

`200 OK` — same shape as one item of `GET /categories`

`404 Not Found`

```json
{ "message": "Category impresoras-x not found", "error": "Not Found", "statusCode": 404 }
```

### GET /brands

Active brands, for filters.

**Auth required:** No

**Responses**

`200 OK`

```json
[{ "id": 1, "name": "Epson", "slug": "epson", "logoUrl": null }]
```

### GET /products

Paginated catalog. Only published products; products set to hide when out of stock are left out while they have no
stock.

**Auth required:** No (optional session for buyer-specific prices)

**Query parameters**

| Param    | Type    | Required | Constraints                                                                                     |
| -------- | ------- | -------- | ----------------------------------------------------------------------------------------------- |
| page     | number  | No       | ≥ 1. Default `1`                                                                                |
| pageSize | number  | No       | 1–48. Default `24`                                                                              |
| category | string  | No       | Category slug. Includes its subcategories                                                       |
| brand    | string  | No       | Comma-separated brand slugs, e.g. `epson`                                                       |
| tag      | string  | No       | Comma-separated tag slugs (any), e.g. `uso-hogar,uso-foto`                                      |
| q        | string  | No       | Max 100. Searches name, short description and SKU (case/accent-insensitive)                     |
| featured | boolean | No       | `true` = only featured products                                                                 |
| sort     | string  | No       | `relevance` (default: featured first, then newest), `newest`, `price-asc`, `price-desc`, `name` |

**Responses**

`200 OK`

```json
{
  "items": [
    {
      "id": 3,
      "slug": "impresora-multifuncional-inalambrica-ecotank-l3250",
      "name": "Impresora Multifuncional Inalámbrica EcoTank L3250",
      "shortDescription": "La Impresora multifuncional 3 en 1 Epson EcoTank L3250 ofrece…",
      "brand": { "name": "Epson", "slug": "epson" },
      "category": { "name": "Para el hogar", "slug": "impresoras-hogar" },
      "imageUrl": "http://localhost:3001/files/products/c11cj67304-1.jpg",
      "price": { "amount": "419999.00", "currency": "ARS" },
      "compareAtPrice": { "amount": "459999.00", "currency": "ARS" },
      "badge": "OFFER",
      "isFeatured": true,
      "availability": "IN_STOCK",
      "outOfStockBehavior": "SHOW_UNAVAILABLE",
      "variantCount": 1
    }
  ],
  "page": 1,
  "pageSize": 24,
  "total": 39,
  "totalPages": 2
}
```

- `price` / `compareAtPrice`: lowest-priced variant for this buyer. `price` is `null` when no variant has a price.
- `badge`: `OFFER` (has a previous price), `NEW` (published in the last 45 days) or `null`.
- `availability`: `IN_STOCK` | `LOW_STOCK` (≤ 3 units, or the variant's own threshold) | `OUT_OF_STOCK`.
- `outOfStockBehavior`: `SHOW_UNAVAILABLE` | `ALLOW_INQUIRY` ("consultar") | `HIDE`.

`400 Bad Request`

```json
{ "message": ["pageSize must not be greater than 48"], "error": "Bad Request", "statusCode": 400 }
```

`404 Not Found` — unknown `category`

### GET /products/:slug

Product page. Everything in the list item plus:

**Auth required:** No (optional session for buyer-specific prices)

**Responses**

`200 OK`

```json
{
  "...": "all ProductSummary fields",
  "description": "…",
  "warrantyMonths": null,
  "seoTitle": null,
  "seoDescription": null,
  "parentCategory": { "name": "Impresoras", "slug": "impresoras" },
  "images": [{ "url": "http://localhost:3001/files/products/c11cj67304-1.jpg", "alt": "…", "variantId": null }],
  "variants": [
    {
      "id": 3,
      "sku": "C11CJ67304",
      "name": null,
      "optionValues": null,
      "isDefault": true,
      "saleUnit": "UNIT",
      "unitsPerSaleUnit": 1,
      "price": { "amount": "419999.00", "currency": "ARS" },
      "compareAtPrice": { "amount": "459999.00", "currency": "ARS" },
      "availability": "IN_STOCK"
    }
  ],
  "specifications": [
    {
      "group": "Imprimir",
      "items": [{ "name": "Resolución Máxima de Impresión", "value": "Hasta 5.760 dpi x 1.440 dpi" }]
    }
  ],
  "tags": [{ "name": "Hogar", "slug": "uso-hogar", "group": "uso" }],
  "compatibleWith": [],
  "compatibleConsumables": [{ "...": "ProductSummary of the T544 ink" }]
}
```

- `variants[].optionValues`: e.g. `{ "Color": "Rosa Cuarzo" }`. `images[].variantId` links a photo to a variant.
- A specification whose value is a URL (group `Documentos`) is a downloadable datasheet.
- `compatibleWith`: machines an ink/paper/part works with. `compatibleConsumables`: inks/papers/parts for a machine.

`404 Not Found` — unknown, unpublished, deleted, or hidden while out of stock

```json
{ "message": "Product x not found", "error": "Not Found", "statusCode": 404 }
```

## Files

### GET /files/:path

Serves public files (product images, logos) from `STORAGE_DIR/public`. Cached for 7 days.

**Auth required:** No

## Admin

Every `/admin/*` route requires a session with role `ADMIN` (`401` without a session, `403` for customers). Admin
users are created with `npm run admin:create`. Every change made through these routes is recorded in `AuditLog`
(who, what, when, from which IP).

### POST /admin/files/images

Uploads an image for the catalog (product photos, brand logos, category images) and returns its id, to be attached
later to a product, brand or category. Send it as `multipart/form-data`.

The type is read from the file's bytes, not from its name or `Content-Type`. Uploading the same image again returns
the file already stored (same `id`) instead of a copy.

**Auth required:** Yes (ADMIN)

**Request body** (`multipart/form-data`)

| Field  | Type | Required | Constraints                   |
| ------ | ---- | -------- | ----------------------------- |
| `file` | file | Yes      | JPG, PNG, WebP or AVIF; ≤5 MB |

**Responses**

`201 Created`

```json
{
  "id": 82,
  "url": "http://localhost:3001/files/uploads/2026/10/2eddb1b7-6d1e-4148-bcb0-c05e13a490ae.png",
  "originalName": "l3250-frente.png",
  "mimeType": "image/png",
  "sizeBytes": 245112
}
```

`400 Bad Request` — no file, or not an accepted image

```json
{ "message": "The file must be a JPG, PNG, WebP or AVIF image", "error": "Bad Request", "statusCode": 400 }
```

`413 Payload Too Large`

```json
{ "message": "File too large", "error": "Payload Too Large", "statusCode": 413 }
```
