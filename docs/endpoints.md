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

### GET /tags

Tags for catalog filters (e.g. the "uso" filter). Filter a product list with `GET /products?tag=<slug>,<slug>`.

**Auth required:** No

**Query**

| Param   | Type   | Required | Constraints              |
| ------- | ------ | -------- | ------------------------ |
| `group` | string | No       | Lowercase slug, e.g. uso |

**Responses**

`200 OK` — ordered by group and name

```json
[{ "id": 1, "name": "Hogar", "slug": "uso-hogar", "group": "uso" }]
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

### Taxonomy (categories, brands, tags)

Common rules for the three resources below:

- **Slugs** are generated from the name when not sent (`"Papeles fotográficos"` → `papeles-fotograficos`; tags
  prefix their group: `uso-hogar`). Changing a slug changes public URLs. A slug in use answers `409`. Creating a
  record whose slug belongs to an **archived** one restores that row (same `id`) with the new data.
- **`DELETE` archives** (soft delete) and answers `204`. Lists never include archived rows.
- **Images** (`imageFileId`, `logoFileId`) are ids from `POST /admin/files/images`; `null` removes the image; an unknown
  id answers `400`.
- **Order**: `PUT …/order` with `{ "ids": [3, 1, 2] }` sets `sortOrder` by position. It must contain **every** sibling
  (all brands; all top-level categories or all subcategories of one parent), otherwise `400`.
- `productCount` counts products in any status (draft, published, hidden), not archived.
- Validation errors answer `400` with the class-validator messages. Unknown ids answer `404`.

### GET /admin/categories

Every category (active or not) as a two-level tree, ordered by `sortOrder`.

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK`

```json
[
  {
    "id": 1,
    "parentId": null,
    "name": "Impresoras",
    "slug": "impresoras",
    "description": null,
    "imageFileId": null,
    "imageUrl": null,
    "sortOrder": 0,
    "isActive": true,
    "productCount": 0,
    "children": [
      {
        "id": 2,
        "parentId": 1,
        "name": "Para el hogar",
        "slug": "impresoras-hogar",
        "description": null,
        "imageFileId": null,
        "imageUrl": null,
        "sortOrder": 0,
        "isActive": true,
        "productCount": 7,
        "children": []
      }
    ]
  }
]
```

### GET /admin/categories/:id

One category with its subcategories. Same shape as an item above. `404` when unknown or archived.

**Auth required:** Yes (ADMIN)

### POST /admin/categories

Creates a category, or a subcategory when `parentId` is sent. It is added at the end of its level.

**Auth required:** Yes (ADMIN)

**Request body**

| Field         | Type           | Required | Constraints                                      |
| ------------- | -------------- | -------- | ------------------------------------------------ |
| `name`        | string         | Yes      | 2–100 chars                                      |
| `slug`        | string         | No       | Lowercase slug, ≤120 chars. Default: from `name` |
| `parentId`    | number \| null | No       | A top-level category (two levels only)           |
| `description` | string \| null | No       | ≤2000 chars                                      |
| `imageFileId` | number \| null | No       | Uploaded image id                                |
| `isActive`    | boolean        | No       | Default `true`. Inactive = hidden from the menu  |

```json
{ "name": "Repuestos y accesorios", "parentId": 1 }
```

**Responses**

`201 Created` — the category (shape of `GET /admin/categories/:id`)

`400 Bad Request` — e.g. parent is a subcategory

```json
{ "message": "Subcategories cannot have subcategories (two levels only)", "error": "Bad Request", "statusCode": 400 }
```

`409 Conflict`

```json
{ "message": "The slug \"impresoras\" is already in use", "error": "Conflict", "statusCode": 409 }
```

### PATCH /admin/categories/:id

Updates any field of `POST /admin/categories` (all optional). A category with subcategories cannot become a
subcategory (`400`).

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK` — the updated category

### PUT /admin/categories/order

Orders the categories of one level. Body: `{ "ids": [2, 3, 4] }`.

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK` — the whole tree, like `GET /admin/categories`

`400 Bad Request`

```json
{ "message": "Send every category of the same level, in the new order", "error": "Bad Request", "statusCode": 400 }
```

### DELETE /admin/categories/:id

Archives an **empty** category.

**Auth required:** Yes (ADMIN)

**Responses**

`204 No Content`

`422 Unprocessable Entity` — it still has subcategories or products

```json
{ "message": "Move its products to another category first", "error": "Unprocessable Entity", "statusCode": 422 }
```

### GET /admin/brands

Every brand (active or not), ordered by `sortOrder`.

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK`

```json
[
  {
    "id": 1,
    "name": "Epson",
    "slug": "epson",
    "logoFileId": null,
    "logoUrl": null,
    "sortOrder": 0,
    "isActive": true,
    "productCount": 39
  }
]
```

### GET /admin/brands/:id

One brand, same shape. **Auth required:** Yes (ADMIN)

### POST /admin/brands

Creates a brand at the end of the list.

**Auth required:** Yes (ADMIN)

**Request body**

| Field        | Type           | Required | Constraints                                      |
| ------------ | -------------- | -------- | ------------------------------------------------ |
| `name`       | string         | Yes      | 1–100 chars                                      |
| `slug`       | string         | No       | Lowercase slug, ≤120 chars. Default: from `name` |
| `logoFileId` | number \| null | No       | Uploaded image id                                |
| `isActive`   | boolean        | No       | Default `true`                                   |

**Responses**

`201 Created` — the brand. `400` / `409` as in the common rules.

### PATCH /admin/brands/:id

Updates any field of `POST /admin/brands` (all optional). **Auth required:** Yes (ADMIN). `200 OK` — the brand.

### PUT /admin/brands/order

Orders **every** brand. Body: `{ "ids": [1, 2] }`. **Auth required:** Yes (ADMIN). `200 OK` — the list.

### DELETE /admin/brands/:id

Archives a brand without products. **Auth required:** Yes (ADMIN)

**Responses**

`204 No Content`

`422 Unprocessable Entity`

```json
{
  "message": "Move its products to another brand first, or deactivate it",
  "error": "Unprocessable Entity",
  "statusCode": 422
}
```

### GET /admin/tags

Every tag with its product count, ordered by group and name.

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK`

```json
[{ "id": 1, "name": "Hogar", "slug": "uso-hogar", "group": "uso", "productCount": 17 }]
```

### GET /admin/tags/:id

One tag, same shape. **Auth required:** Yes (ADMIN)

### POST /admin/tags

**Auth required:** Yes (ADMIN)

**Request body**

| Field   | Type           | Required | Constraints                                                     |
| ------- | -------------- | -------- | --------------------------------------------------------------- |
| `name`  | string         | Yes      | 1–100 chars                                                     |
| `slug`  | string         | No       | Lowercase slug, ≤120 chars. Default: group + name (`uso-hogar`) |
| `group` | string \| null | No       | Lowercase slug, ≤50 chars, e.g. `uso`                           |

**Responses**

`201 Created` — the tag. `400` / `409` as in the common rules.

### PATCH /admin/tags/:id

Updates any field of `POST /admin/tags` (all optional). **Auth required:** Yes (ADMIN). `200 OK` — the tag.

### DELETE /admin/tags/:id

Archives the tag **and removes it from every product** that had it.

**Auth required:** Yes (ADMIN)

**Responses**

`204 No Content`
