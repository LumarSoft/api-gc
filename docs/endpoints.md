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
| page     | number  | No       | 1–10000. Default `1`                                                                            |
| pageSize | number  | No       | 1–48. Default `24`                                                                              |
| category | string  | No       | Category slug. Includes its subcategories                                                       |
| brand    | string  | No       | Comma-separated brand slugs, e.g. `epson`                                                       |
| tag      | string  | No       | Comma-separated tag slugs (any), e.g. `uso-hogar,uso-foto`                                      |
| q        | string  | No       | Max 100. Searches name, short description and SKU (case/accent-insensitive)                     |
| featured | boolean | No       | `true` = only featured products                                                                 |
| onSale   | boolean | No       | `true` = only offers: the buyer's lowest price is below its previous price (same as `OFFER`)    |
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

### Products (admin)

`/admin/products/*` manage the catalog. Prices are shown **as stored** (amount + currency, never converted) in the
default retail list. Every write answers the full `AdminProduct` (shape of `GET /admin/products/:id`) and is audited.

`issues` (what a product still needs): `NO_ACTIVE_VARIANT`, `NO_RETAIL_PRICE` (no active variant has a retail price)
— both block publishing — and `NO_IMAGE` (warning only).

### GET /admin/products

Paginated list, any status, archived products excluded.

**Auth required:** Yes (ADMIN)

**Query**

| Param        | Type   | Required | Constraints                                                  |
| ------------ | ------ | -------- | ------------------------------------------------------------ |
| `page`       | number | No       | 1–10000, default 1                                           |
| `pageSize`   | number | No       | 1–100, default 25                                            |
| `q`          | string | No       | Name or SKU, ≤100 chars                                      |
| `status`     | enum   | No       | `DRAFT` \| `PUBLISHED` \| `HIDDEN`                           |
| `categoryId` | number | No       | Includes its subcategories                                   |
| `brandId`    | number | No       |                                                              |
| `stock`      | `out`  | No       | Only products without available stock in any active variant  |
| `sort`       | enum   | No       | `updated` (default, last edited first) \| `name` \| `newest` |

**Responses**

`200 OK`

```json
{
  "items": [
    {
      "id": 39,
      "name": "Botella de tinta original Epson T544",
      "slug": "botella-de-tinta-original-epson-t544",
      "status": "PUBLISHED",
      "imageUrl": null,
      "category": { "id": 5, "name": "Tintas y consumibles" },
      "brand": { "id": 1, "name": "Epson" },
      "sku": "T544120-AL",
      "variantCount": 4,
      "retailPrice": { "amount": "18999.00", "currency": "ARS" },
      "available": 115,
      "availability": "IN_STOCK",
      "isFeatured": true,
      "outOfStockBehavior": "SHOW_UNAVAILABLE",
      "issues": ["NO_IMAGE"],
      "publishedAt": "2026-06-11T18:00:49.772Z",
      "updatedAt": "2026-10-03T18:00:49.773Z"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 39,
  "totalPages": 2
}
```

`sku` and `retailPrice` come from the default variant; `available` sums active variants (on hand − reserved).

### GET /admin/products/:id

The product editor's data.

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK`

```json
{
  "id": 40,
  "type": "STANDARD",
  "status": "DRAFT",
  "name": "Epson EcoTank L3250",
  "slug": "epson-ecotank-l3250",
  "categoryId": 2,
  "brandId": 1,
  "shortDescription": "Multifuncional con Wi-Fi.",
  "description": "…",
  "isFeatured": false,
  "outOfStockBehavior": "SHOW_UNAVAILABLE",
  "warrantyMonths": 12,
  "seoTitle": null,
  "seoDescription": null,
  "images": [
    {
      "id": 81,
      "fileId": 82,
      "url": "http://localhost:3001/files/uploads/…png",
      "altText": "Frente",
      "variantId": null
    }
  ],
  "specifications": [{ "id": 648, "groupName": "Impresión", "name": "Velocidad", "value": "33 ppm" }],
  "tags": [{ "id": 1, "name": "Hogar", "slug": "uso-hogar", "group": "uso" }],
  "variants": [
    {
      "id": 47,
      "sku": "L3250-AR",
      "name": null,
      "isDefault": true,
      "isActive": true,
      "retailPrice": null,
      "available": null,
      "availability": "OUT_OF_STOCK"
    }
  ],
  "issues": ["NO_RETAIL_PRICE"],
  "publishedAt": null,
  "createdAt": "2026-10-04T18:00:00.000Z",
  "updatedAt": "2026-10-04T18:05:00.000Z"
}
```

`404 Not Found` — unknown or archived.

### POST /admin/products

Creates a **draft** with its default variant (every product has at least one sellable SKU).

**Auth required:** Yes (ADMIN)

**Request body**

| Field              | Type           | Required | Constraints                                  |
| ------------------ | -------------- | -------- | -------------------------------------------- |
| `name`             | string         | Yes      | 2–200 chars                                  |
| `slug`             | string         | No       | Lowercase slug ≤220. Default: from `name`    |
| `categoryId`       | number         | Yes      | Existing category (top-level or subcategory) |
| `brandId`          | number \| null | No       | Existing brand                               |
| `sku`              | string         | Yes      | ≤60, letters, numbers, `.`, `-`, `_`; unique |
| `shortDescription` | string \| null | No       | ≤500                                         |

**Responses**

`201 Created` — the product. `400` unknown category/brand. `409` SKU in use (also by an archived product), or a
`slug` sent explicitly that is in use. Without `slug`, it is generated from the name and numbered when taken
(`epson-l3250-2`). Unlike categories, brands and tags, **archived products are never restored** by reusing their
slug: that would bring back their old variants, photos and specifications.

### PATCH /admin/products/:id

General data, all optional: `name`, `slug`, `categoryId`, `brandId` (null removes it), `shortDescription` (≤500),
`description` (≤20000), `isFeatured`, `outOfStockBehavior` (`SHOW_UNAVAILABLE` \| `HIDE` \| `ALLOW_INQUIRY`),
`warrantyMonths` (0–240), `seoTitle` (≤70), `seoDescription` (≤160).

**Auth required:** Yes (ADMIN). `200 OK` — the product.

### PUT /admin/products/:id/status

Body `{ "status": "DRAFT" | "PUBLISHED" | "HIDDEN" }`. The first publication date is kept when it is published again.

**Auth required:** Yes (ADMIN)

**Responses**

`200 OK` — the product.

`422 Unprocessable Entity`

```json
{
  "message": "Cannot publish: no active variant has a retail price",
  "error": "Unprocessable Entity",
  "statusCode": 422
}
```

### POST /admin/products/bulk

Publish, hide, move to draft or archive several products at once (the admin list's selection). Runs in one
transaction with the products locked, and records one audit entry per changed product (`product.status` or
`product.archive`), exactly like the single-product routes. Publishing follows the same rule as
`PUT /admin/products/:id/status`: products with a blocking issue are skipped and reported, the rest are published; the
first publication date is kept. Archived or unknown ids are reported as `NOT_FOUND`, never fatal.

**Auth required:** Yes (ADMIN).

**Request body**

| Field    | Type      | Required | Constraints                                  |
| -------- | --------- | -------- | -------------------------------------------- |
| `ids`    | integer[] | Yes      | 1–100 positive integers (duplicates ignored) |
| `action` | string    | Yes      | `PUBLISH`, `HIDE`, `DRAFT` or `ARCHIVE`      |

```json
{ "ids": [12, 15, 18], "action": "PUBLISH" }
```

**Responses**

`200 OK` — `updated` changed (or archived), `unchanged` were already in that status, `skipped` were not touched.

```json
{
  "updated": [12],
  "unchanged": [18],
  "skipped": [{ "id": 15, "reason": "CANNOT_PUBLISH", "issues": ["NO_RETAIL_PRICE"] }]
}
```

`400 Bad Request` — e.g. `{ "message": ["ids must contain no more than 100 elements"], "statusCode": 400 }`.
`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.

### PUT /admin/products/:id/images

The whole gallery, in order (the first image is the main one). Rows left out are removed; kept rows send their `id`.

**Auth required:** Yes (ADMIN)

**Request body**

| Field                | Type           | Required | Constraints                                   |
| -------------------- | -------------- | -------- | --------------------------------------------- |
| `images`             | array          | Yes      | ≤30 items                                     |
| `images[].id`        | number         | No       | An image of this product (omit for a new one) |
| `images[].fileId`    | number         | Yes      | From `POST /admin/files/images`               |
| `images[].altText`   | string \| null | No       | ≤200                                          |
| `images[].variantId` | number \| null | No       | A variant of this product                     |

```json
{
  "images": [
    { "id": 82, "fileId": 81 },
    { "fileId": 90, "altText": "Vista lateral" }
  ]
}
```

`200 OK` — the product. `400` unknown file, foreign variant, or an `id` that is not one of this product's images.

### PUT /admin/products/:id/specifications

The whole technical sheet, in order: `{ "specifications": [{ "id"?, "groupName"?, "name", "value" }] }` (≤200 rows;
`name` ≤100, `value` ≤500, `groupName` ≤100). Same rules as images.

**Auth required:** Yes (ADMIN). `200 OK` — the product.

### PUT /admin/products/:id/tags

Every tag of the product: `{ "tagIds": [1, 2] }` (≤50, unique). Tags left out are unlinked.

**Auth required:** Yes (ADMIN). `200 OK` — the product. `400` unknown tag.

### POST /admin/products/:id/duplicate

Creates a **draft** copy: name `"<name> (copia)"`, slug `<slug>-copia` (`-copia-2`, …), every variant with SKU
`<sku>-COPIA` (`-COPIA-2`, …) and the same prices, images (same files, variant photos re-linked), specifications and
tags. Not copied: Tango codes, stock, featured flag and publication date.

**Auth required:** Yes (ADMIN). `201 Created` — the new product.

`variants[]` in `AdminProduct` also carry everything the variant editor needs:

```json
{
  "id": 47,
  "sku": "L3250-AR",
  "name": "Negro",
  "isDefault": true,
  "isActive": true,
  "retailPrice": { "amount": "419999.00", "currency": "ARS" },
  "available": 12,
  "availability": "IN_STOCK",
  "optionValues": { "Color": "Negro" },
  "barcode": null,
  "source": "MANUAL",
  "tangoCode": null,
  "saleUnit": "UNIT",
  "unitsPerSaleUnit": 1,
  "weightGrams": 4500,
  "lengthMm": 375,
  "widthMm": 347,
  "heightMm": 179,
  "isBulky": false,
  "prices": [
    { "priceListId": 1, "amount": "419999.00", "currency": "ARS", "compareAtAmount": "459999.00", "source": "MANUAL" },
    { "priceListId": 2, "amount": "289.00", "currency": "USD", "compareAtAmount": null, "source": "MANUAL" }
  ],
  "stock": { "onHand": 12, "reserved": 0, "lowStockThreshold": 2 }
}
```

### DELETE /admin/products/:id

Archives the product (soft delete): it leaves the store and the admin list. Orders keep their own snapshot.

**Auth required:** Yes (ADMIN). `204 No Content`.

### Variants (admin)

`/admin/products/:id/variants/*`. Every answer is the updated `AdminProduct`. `404` when the variant is not one of
the product's (or is archived).

#### POST /admin/products/:id/variants

**Auth required:** Yes (ADMIN)

**Request body** (also the fields of `PATCH`, all optional there)

| Field                             | Type           | Required | Constraints                                                     |
| --------------------------------- | -------------- | -------- | --------------------------------------------------------------- |
| `sku`                             | string         | Yes      | ≤60, letters, numbers, `.`, `-`, `_`; unique forever (`409`)    |
| `name`                            | string \| null | No       | ≤150, e.g. "Cyan 70 ml"                                         |
| `optionValues`                    | object \| null | No       | ≤5 entries, name ≤50 / value ≤100: `{ "Color": "Cyan" }`        |
| `barcode`                         | string \| null | No       | ≤50                                                             |
| `isActive`                        | boolean        | No       | Default `true`                                                  |
| `saleUnit`                        | enum           | No       | `UNIT` `BOX` `PACK` `ROLL` `METER` `SQUARE_METER` `LITER` `KIT` |
| `unitsPerSaleUnit`                | number         | No       | 1–10000                                                         |
| `weightGrams`                     | number \| null | No       | Shipping data                                                   |
| `lengthMm`, `widthMm`, `heightMm` | number \| null | No       | Shipping data                                                   |
| `isBulky`                         | boolean        | No       | Machines and oversized items                                    |

`201 Created`. A new variant is never the default one.

#### PATCH /admin/products/:id/variants/:variantId

Same fields, all optional. `422` when deactivating the default variant (choose another default first).

#### PUT /admin/products/:id/variants/:variantId/default

Makes it the variant preselected on the product page. `422` if it is inactive.

#### DELETE /admin/products/:id/variants/:variantId

Archives the variant; its photos stay as general photos. `422` for the last variant of the product, or for the
default one when no other variant is active. Archiving the default promotes the first other active variant.

#### PUT /admin/products/:id/variants/:variantId/prices

Every price of the variant, one per price list (`GET /admin/price-lists`). Lists left out lose their price.

| Field                      | Type           | Required | Constraints                                      |
| -------------------------- | -------------- | -------- | ------------------------------------------------ |
| `prices[].priceListId`     | number         | Yes      | Existing list, once                              |
| `prices[].amount`          | string         | Yes      | Decimal, up to 2 decimals, > 0 (`"419999.90"`)   |
| `prices[].currency`        | `ARS` \| `USD` | Yes      | USD is shown in ARS at the current exchange rate |
| `prices[].compareAtAmount` | string \| null | No       | Crossed-out price, same currency, above `amount` |

```json
{
  "prices": [
    { "priceListId": 1, "amount": "419999", "currency": "ARS", "compareAtAmount": "459999" },
    { "priceListId": 2, "amount": "289", "currency": "USD" }
  ]
}
```

`200 OK` — the product. `400` invalid amounts, repeated list, crossed-out price not higher, unknown list. Prices
saved here become `MANUAL` (a future Tango sync must not overwrite them).

#### PUT /admin/products/:id/variants/:variantId/stock

**Provisional** manual stock count until stock comes from Tango. Body: `{ "onHand": 12, "lowStockThreshold": 2,
"note": "Conteo del 5/10" }` (`onHand` 0–1000000; `lowStockThreshold` null = default 3; `note` ≤255). Records an
`ADJUSTMENT` stock movement with the difference. `422` when `onHand` is below the units reserved by open orders.

### Pricing (admin)

#### GET /admin/price-lists

**Auth required:** Yes (ADMIN)

`200 OK`

```json
[
  { "id": 1, "code": "RETAIL", "name": "Precio de lista", "audience": "RETAIL", "isDefault": true },
  { "id": 2, "code": "WHOLESALE", "name": "Clientes frecuentes", "audience": "WHOLESALE", "isDefault": true }
]
```

#### GET /admin/exchange-rates

USD exchange rate: the one in effect, those scheduled for later, and the history (`?limit=` 1–100, default 20).

**Auth required:** Yes (ADMIN)

`200 OK`

```json
{
  "current": {
    "id": 4,
    "currency": "USD",
    "rate": "1475.5000",
    "source": "MANUAL",
    "effectiveFrom": "2026-10-05T12:00:00.000Z",
    "createdAt": "2026-10-05T12:00:00.000Z"
  },
  "scheduled": [],
  "history": [
    { "id": 4, "currency": "USD", "rate": "1475.5000", "source": "MANUAL", "effectiveFrom": "…", "createdAt": "…" }
  ]
}
```

#### POST /admin/exchange-rates

Loads a new rate (append-only history). Body: `{ "rate": "1475.50", "effectiveFrom"?: ISO date }` — up to 4
decimals, > 0; `effectiveFrom` defaults to now and may be in the future (scheduled), never in the past (`400`).

**Auth required:** Yes (ADMIN). `201 Created` — same shape as `GET /admin/exchange-rates`.

## Admin home

### GET /admin/dashboard

Summary for the admin home: a period of Argentine calendar days (by default the last 30, today included) against the
previous period of the same length, and the work waiting outside orders (order stages come from
`GET /admin/orders/counts`).

**Query**

| Field  | Type   | Required | Constraints                                                                 |
| ------ | ------ | -------- | --------------------------------------------------------------------------- |
| `from` | string | No       | Calendar day `YYYY-MM-DD` (Argentina), first day included. With `to`.       |
| `to`   | string | No       | Calendar day, last day included; not after today; at most 366 days in total |

`400 Bad Request` for a malformed or impossible day (`"from must be a calendar day (YYYY-MM-DD)"`), only one end
(`"Indicá el inicio y el fin del período."`), a reversed range, a range ending in the future or longer than 366 days.

- `sales`: orders whose payment staff verified (`CONFIRMED` through `DELIVERED`), by confirmation date, ARS.
- `orders`: orders placed, by placement date, whatever happened to them later.
- `averageOrder`: sales divided by paid orders; `null` when there were none.
- `daily` arrays have one value per entry of `days` (oldest first), zero on days without activity.

**Auth required:** Yes (ADMIN).

**Responses**

`200 OK`

```json
{
  "days": ["2026-09-09", "…", "2026-10-08"],
  "sales": {
    "current": { "amount": "2239997.00", "currency": "ARS" },
    "previous": { "amount": "0.00", "currency": "ARS" },
    "daily": ["0.00", "…", "2239997.00"]
  },
  "orders": { "current": 5, "previous": 0, "daily": [0, "…", 5] },
  "averageOrder": { "current": { "amount": "2239997.00", "currency": "ARS" }, "previous": null },
  "todo": { "wholesalePending": 1, "publishedOutOfStock": 2, "drafts": 0 }
}
```

`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.

## Admin analytics

### GET /admin/analytics

Stats for the admin "Estadísticas" page: a period of Argentine calendar days (by default the last 30, today included)
against the previous period of the same length.

**Auth required:** Yes (ADMIN).

**Query**

| Field     | Type   | Required | Constraints                                                                             |
| --------- | ------ | -------- | --------------------------------------------------------------------------------------- |
| `from`    | string | No       | Calendar day `YYYY-MM-DD` (Argentina), first day included. With `to`.                   |
| `to`      | string | No       | Calendar day, last day included; not after today; at most 366 days in total             |
| `groupBy` | string | No       | `day` \| `week` \| `month`. Default: days up to 45 days, weeks up to 182, months beyond |

`400 Bad Request` for the same period errors as `GET /admin/dashboard`, or a `groupBy` outside the list
(`"groupBy must be one of the following values: day, week, month"`).

- **Sales** are paid orders (`CONFIRMED` through `DELIVERED`, ARS) by payment confirmation date. An order cancelled after
  its payment is not a sale. `breakdown`: products (before discounts) − discounts + shipping = sales.
- `buckets`: chart points, oldest first. Weeks run Monday to Sunday and months are calendar months, both cut at the
  ends of the period. `previousStart`/`previousEnd` are the same offsets in the previous period; every `series` has one
  value per bucket.
- `outcomes`: orders **placed** in the period by their current status (`waiting` = pending payment or under review).
- `hoursToPay`: median hours from placing an order to staff confirming its payment; `null` without paid orders.
- `buyerTypes`, `paymentMethods`, `deliveryMethods`: paid orders and sales per value, biggest first, with the previous
  period's sales.
- `products` (top 10), `categories` and `brands` (top 8): units and line totals of paid orders (before order discounts,
  without shipping). A subcategory counts for its top-level category; `brands[].id: null` = products without a brand.
  `archived: true` = the product was archived since (no admin page).
- `customers`: told apart by order email (guests have no account). `returning` = customers of the period who had a
  paid order before it. `signUps`: customer accounts created. `frequentCustomerApplications.approved`: approved in the
  period and still approved; `pending`: waiting now, whatever the period.

**Responses**

`200 OK`

```json
{
  "period": {
    "from": "2026-09-09",
    "to": "2026-10-08",
    "previousFrom": "2026-08-10",
    "previousTo": "2026-09-08",
    "groupBy": "day"
  },
  "buckets": [
    { "start": "2026-09-09", "end": "2026-09-09", "previousStart": "2026-08-10", "previousEnd": "2026-08-10" },
    "…"
  ],
  "sales": {
    "current": { "amount": "2239997.00", "currency": "ARS" },
    "previous": { "amount": "1450000.00", "currency": "ARS" },
    "series": { "current": ["0.00", "…"], "previous": ["0.00", "…"] }
  },
  "breakdown": {
    "products": {
      "current": { "amount": "2236497.00", "currency": "ARS" },
      "previous": { "amount": "1450000.00", "currency": "ARS" }
    },
    "discounts": {
      "current": { "amount": "0.00", "currency": "ARS" },
      "previous": { "amount": "0.00", "currency": "ARS" }
    },
    "shipping": {
      "current": { "amount": "3500.00", "currency": "ARS" },
      "previous": { "amount": "0.00", "currency": "ARS" }
    }
  },
  "orders": { "current": 5, "previous": 3, "series": { "current": [0, "…"], "previous": [0, "…"] } },
  "averageOrder": {
    "current": { "amount": "447999.40", "currency": "ARS" },
    "previous": { "amount": "483333.33", "currency": "ARS" }
  },
  "outcomes": {
    "current": { "placed": 8, "paid": 5, "waiting": 1, "expired": 1, "cancelled": 1 },
    "previous": { "placed": 4, "paid": 3, "waiting": 0, "expired": 1, "cancelled": 0 }
  },
  "hoursToPay": { "current": 5.5, "previous": 20 },
  "buyerTypes": [
    {
      "key": "RETAIL",
      "orders": 3,
      "sales": { "amount": "1400000.00", "currency": "ARS" },
      "previousSales": { "amount": "1450000.00", "currency": "ARS" }
    }
  ],
  "paymentMethods": [
    {
      "key": "MANUAL",
      "orders": 5,
      "sales": { "amount": "2239997.00", "currency": "ARS" },
      "previousSales": { "amount": "1450000.00", "currency": "ARS" }
    }
  ],
  "deliveryMethods": [
    {
      "key": "STORE_PICKUP",
      "orders": 4,
      "sales": { "amount": "1839997.00", "currency": "ARS" },
      "previousSales": { "amount": "1450000.00", "currency": "ARS" }
    }
  ],
  "products": [
    {
      "id": 12,
      "name": "Impresora Epson EcoTank L3250",
      "units": 3,
      "sales": { "amount": "1259997.00", "currency": "ARS" },
      "previousSales": { "amount": "419999.00", "currency": "ARS" },
      "imageUrl": "http://localhost:3001/files/products/l3250.webp",
      "archived": false
    }
  ],
  "categories": [
    {
      "id": 1,
      "name": "Impresoras",
      "units": 4,
      "sales": { "amount": "1679996.00", "currency": "ARS" },
      "previousSales": { "amount": "419999.00", "currency": "ARS" }
    }
  ],
  "brands": [
    {
      "id": 1,
      "name": "Epson",
      "units": 9,
      "sales": { "amount": "2236497.00", "currency": "ARS" },
      "previousSales": { "amount": "1450000.00", "currency": "ARS" }
    }
  ],
  "customers": {
    "total": { "current": 4, "previous": 3 },
    "returning": { "current": 1, "previous": 0 },
    "newSales": { "amount": "1839997.00", "currency": "ARS" },
    "returningSales": { "amount": "400000.00", "currency": "ARS" },
    "signUps": { "current": 6, "previous": 2 },
    "frequentCustomerApplications": {
      "received": { "current": 2, "previous": 1 },
      "approved": { "current": 1, "previous": 0 },
      "pending": 1
    }
  }
}
```

`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.

### GET /admin/analytics/behavior

What anonymous visitors did in the store (see `POST /activity`) and abandoned carts, over the same period and
`groupBy` as `GET /admin/analytics` (same query, same `400` errors).

**Auth required:** Yes (ADMIN).

- Visitors are anonymous browser ids, counted once (`COUNT(DISTINCT)`) per period, per chart point and per step.
- `trackingSince`: Argentine day of the first recorded event, `null` before any. Days before it have **no data**, not
  zero activity: the front says so instead of showing a drop.
- `funnel`: visitors with any event (`visited`), and those who viewed a product, added to cart, started checkout and
  placed an order. Steps are counted independently (adding from a list card needs no product view).
- `products`: top 10 by visitors who viewed them, with visitors who added them to a cart and units sold (paid orders of
  the period, like `GET /admin/analytics`).
- `searches.top` / `searches.unanswered`: top 10 texts by visitors; `unanswered` only texts that never found a product.
  `results` is the most products a search with that text found.
- `carts.abandoned`: carts with products, never ordered, last touched in the period and at least `abandonAfterHours`
  (24) ago. `ordersPlaced`: orders placed in the period, to compare against. `products`: top 5 left behind (carts that
  contain them, units).

**Responses**

`200 OK`

```json
{
  "period": {
    "from": "2026-09-09",
    "to": "2026-10-08",
    "previousFrom": "2026-08-10",
    "previousTo": "2026-09-08",
    "groupBy": "day"
  },
  "buckets": [
    { "start": "2026-09-09", "end": "2026-09-09", "previousStart": "2026-08-10", "previousEnd": "2026-08-10" },
    "…"
  ],
  "trackingSince": "2026-10-08",
  "visitors": { "current": 412, "previous": 0, "series": { "current": [0, "…", 412], "previous": [0, "…"] } },
  "funnel": {
    "current": { "visited": 412, "viewedProduct": 251, "addedToCart": 34, "startedCheckout": 18, "placedOrder": 9 },
    "previous": { "visited": 0, "viewedProduct": 0, "addedToCart": 0, "startedCheckout": 0, "placedOrder": 0 }
  },
  "products": [
    {
      "id": 12,
      "name": "Impresora Epson EcoTank L3250",
      "imageUrl": "http://localhost:3001/files/products/l3250.webp",
      "archived": false,
      "viewers": 96,
      "addedToCart": 11,
      "unitsSold": 4
    }
  ],
  "searches": {
    "total": { "current": 120, "previous": 0 },
    "withoutResults": { "current": 31, "previous": 0 },
    "top": [{ "query": "ecotank", "searches": 22, "visitors": 19, "results": 18 }],
    "unanswered": [{ "query": "papel fotografico", "searches": 9, "visitors": 8, "results": 0 }]
  },
  "carts": {
    "abandoned": { "current": 21, "previous": 0 },
    "ordersPlaced": { "current": 85, "previous": 75 },
    "abandonAfterHours": 24,
    "products": [
      { "id": 12, "name": "Impresora Epson EcoTank L3250", "imageUrl": null, "archived": false, "carts": 6, "units": 7 }
    ]
  }
}
```

`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.

## Admin settings

Store settings staff change from the admin. Both writes are audited (`settings.local-delivery`, `settings.reservation`)
and take effect on the next checkout request.

### GET /admin/settings

**Auth required:** Yes (ADMIN).

`200 OK`

```json
{
  "localDelivery": {
    "isActive": true,
    "flatRate": { "amount": "3500.00", "currency": "ARS" },
    "freeShippingThreshold": { "amount": "80000.00", "currency": "ARS" }
  },
  "reservation": { "manualHours": 24, "isDefault": true }
}
```

`flatRate` / `freeShippingThreshold` are `null` until set; `isDefault` means no stored window (24 hours apply).
`401 Unauthorized`, `403 Forbidden` as other admin routes.

### PUT /admin/settings/local-delivery

Rosario delivery (`ShippingMethod` `LOCAL_DELIVERY`), created on first save. Checkout offers it only while active.

**Auth required:** Yes (ADMIN).

| Field                   | Type           | Required | Constraints                                                     |
| ----------------------- | -------------- | -------- | --------------------------------------------------------------- |
| `isActive`              | boolean        | Yes      |                                                                 |
| `flatRate`              | string \| null | No       | ARS, `^\d{1,10}(\.\d{1,2})?$`; required when `isActive` is true |
| `freeShippingThreshold` | string \| null | No       | ARS, same format, above zero; `null` = never free               |

```json
{ "isActive": true, "flatRate": "3500", "freeShippingThreshold": "80000" }
```

`200 OK` — the settings, as in `GET /admin/settings`.
`400 Bad Request` — malformed amount: `{ "message": ["flatRate must match /^\\d{1,10}(\\.\\d{1,2})?$/ regular expression"], "statusCode": 400 }`.
`422 Unprocessable Entity` — `{ "message": "Para activar la entrega en Rosario cargá la tarifa.", "statusCode": 422 }` or
`"El monto para envío gratis tiene que ser mayor a cero."`.

### PUT /admin/settings/reservation

Hours a pending manual-payment order keeps its stock reserved (`Setting` `reservation.manualHours`).

**Auth required:** Yes (ADMIN).

| Field         | Type    | Required | Constraints |
| ------------- | ------- | -------- | ----------- |
| `manualHours` | integer | Yes      | 1–168       |

`200 OK` — the settings. `400 Bad Request` — `{ "message": ["manualHours must not be greater than 168"], "statusCode": 400 }`.

## Checkout preparation

Browser-only, optional authentication. Guest ownership uses the existing `cg_cart` cookie (path `/cart`);
authenticated ownership and guest merges follow the cart rules. All responses are `private, no-store`.
GET and preview prepare a review without persisting contact details or reserving stock. POST orders below confirms
the purchase and reserves stock; no endpoint initiates an external payment.

### GET /cart/checkout

Read the current cart, available delivery options and initial pickup totals. No cart is created for an empty visitor.

**Auth required:** No. An invalid session returns `401`; refresh the session and retry.

**Responses**

`200 OK` — example with an empty cart (the same shape contains real lines for an owned cart):

```json
{
  "cart": { "items": [], "itemCount": 0, "subtotal": { "amount": "0.00", "currency": "ARS" }, "hasIssues": false },
  "deliveryOptions": [
    {
      "code": "STORE_PICKUP",
      "name": "Retiro en el local",
      "description": "Retirá tu compra en Rosario, sin costo de envío.",
      "enabled": true,
      "cost": { "amount": "0.00", "currency": "ARS" },
      "unavailableReason": null
    },
    {
      "code": "LOCAL_DELIVERY",
      "name": "Entrega en Rosario",
      "description": "Entrega a domicilio dentro de Rosario.",
      "enabled": false,
      "cost": null,
      "unavailableReason": "La entrega a domicilio todavía no está disponible."
    },
    {
      "code": "CARRIER",
      "name": "Envío al resto del país",
      "description": "El costo depende del destino y de los productos.",
      "enabled": false,
      "cost": null,
      "unavailableReason": "La cotización de envíos todavía no está disponible."
    }
  ],
  "deliveryMethod": "STORE_PICKUP",
  "shippingTotal": { "amount": "0.00", "currency": "ARS" },
  "total": { "amount": "0.00", "currency": "ARS" },
  "customer": null,
  "shippingAddress": null,
  "canReview": false,
  "reviewToken": null,
  "reservationHours": 24
}
```

Local delivery costs come from the active ARS `ShippingMethod` rate and free-shipping threshold. Missing/negative
rates, negative thresholds, inactive methods and USD rates are unavailable. Carrier quotes are not implemented.
`canReview` requires a nonempty cart without price/stock issues. `total` is null when it cannot be fully priced in ARS.

`401 Unauthorized`

```json
{ "message": "Unauthorized", "statusCode": 401 }
```

`429 Too Many Requests` — browser rate limit.

```json
{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }
```

### POST /cart/checkout/preview

Validate contact and delivery, reprice the owner's current cart and return the review. Contact/address values are
echoed for this response only; later GET requests return `customer: null` and `shippingAddress: null`.

**Auth required:** No. Same optional-session and cookie rules as GET.

**Request body**

| Field                          | Type   | Required              | Constraints                                                           |
| ------------------------------ | ------ | --------------------- | --------------------------------------------------------------------- |
| `name`                         | string | Yes                   | Trimmed, nonempty, max 200                                            |
| `email`                        | string | Yes                   | Valid email, trimmed, max 191                                         |
| `phone`                        | string | No                    | Trimmed, max 30                                                       |
| `deliveryMethod`               | enum   | Yes                   | `STORE_PICKUP`, `LOCAL_DELIVERY`, `CARRIER`; method must be available |
| `shippingAddress`              | object | For local delivery    | Validated nested object; city Rosario, province Santa Fe              |
| `shippingAddress.street`       | string | When address supplied | Trimmed, nonempty, max 150                                            |
| `shippingAddress.streetNumber` | string | When address supplied | Trimmed, nonempty, max 20                                             |
| `shippingAddress.city`         | string | When address supplied | Trimmed, nonempty, max 100                                            |
| `shippingAddress.province`     | string | When address supplied | Trimmed, nonempty, max 100                                            |
| `shippingAddress.postalCode`   | string | When address supplied | Trimmed, nonempty, max 10                                             |

```json
{ "name": "Cliente de prueba", "email": "cliente@example.test", "deliveryMethod": "STORE_PICKUP" }
```

**Responses**

`200 OK` — same complete shape as GET, with freshly priced real cart lines, `canReview: true`, the selected method,
its shipping cost and the exact full total. `customer` contains `{ "name": "Cliente de prueba", "email":
"cliente@example.test", "phone": null }`; local delivery returns the validated address, pickup returns null.

Example for a cart containing one unit of a test product (sample data):

```json
{
  "cart": {
    "items": [
      {
        "variantId": 1,
        "sku": "CHECKOUT-TEST",
        "name": "Checkout test product",
        "variantName": null,
        "productSlug": "checkout-test-product",
        "imageUrl": null,
        "quantity": 1,
        "availableQuantity": 18,
        "unitPrice": { "amount": "12.35", "currency": "ARS" },
        "total": { "amount": "12.35", "currency": "ARS" },
        "issue": null
      }
    ],
    "itemCount": 1,
    "subtotal": { "amount": "12.35", "currency": "ARS" },
    "hasIssues": false
  },
  "deliveryOptions": [
    {
      "code": "STORE_PICKUP",
      "name": "Retiro en el local",
      "description": "Retirá tu compra en Rosario, sin costo de envío.",
      "enabled": true,
      "cost": { "amount": "0.00", "currency": "ARS" },
      "unavailableReason": null
    },
    {
      "code": "LOCAL_DELIVERY",
      "name": "Entrega en Rosario",
      "description": "Entrega a domicilio dentro de Rosario.",
      "enabled": false,
      "cost": null,
      "unavailableReason": "La entrega a domicilio todavía no está disponible."
    },
    {
      "code": "CARRIER",
      "name": "Envío al resto del país",
      "description": "El costo depende del destino y de los productos.",
      "enabled": false,
      "cost": null,
      "unavailableReason": "La cotización de envíos todavía no está disponible."
    }
  ],
  "deliveryMethod": "STORE_PICKUP",
  "shippingTotal": { "amount": "0.00", "currency": "ARS" },
  "total": { "amount": "12.35", "currency": "ARS" },
  "customer": { "name": "Cliente de prueba", "email": "cliente@example.test", "phone": null },
  "shippingAddress": null,
  "canReview": true,
  "reviewToken": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "reservationHours": 24
}
```

`400 Bad Request` — invalid contact/address/enum or unknown fields (including client-supplied totals/ownership).

```json
{ "message": ["email must be an email"], "error": "Bad Request", "statusCode": 400 }
```

`422 Unprocessable Entity` — empty cart, cart price/stock issue, unavailable delivery or local address outside Rosario.

```json
{
  "message": "Tu carrito está vacío. Agregá productos antes de continuar.",
  "error": "Unprocessable Entity",
  "statusCode": 422
}
```

`401` and `429` have the same format as GET.

## Cart

Browser-only endpoints. **Auth required:** No; an optional valid session selects the authenticated user's cart and
price list. An invalid/expired session returns `401` so the browser refreshes it. Anonymous carts use a 30-day
`cg_cart` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/cart`, existing `COOKIE_SECURE`/`COOKIE_DOMAIN` settings).
The API stores only the token hash. Neither user ids, cart ids nor prices are accepted from the browser.

The first cart request after login claims or merges the guest cart with the user's cart and clears the guest cookie.
Duplicate variants have their quantities added, capped at the technical limit of 1,000,000 per line; merging preserves
lines with stock/price issues. It is transactional and happens once. User carts persist across sessions/devices.

Every successful endpoint returns the complete **Cart response** below, with `Cache-Control: private, no-store`.
These browser routes retain the global per-IP rate limit. They must not be called from Server Components.
Cart lines are one aggregate, not a paginated collection. Stock is checked but not reserved until checkout.

**Cart response (example data)**

```json
{
  "items": [
    {
      "variantId": 12,
      "sku": "SAMPLE-SKU",
      "name": "Producto de ejemplo",
      "variantName": "Negro",
      "productSlug": "producto-ejemplo",
      "imageUrl": "http://localhost:3001/files/products/example.jpg",
      "quantity": 2,
      "availableQuantity": 8,
      "unitPrice": { "amount": "1234.50", "currency": "ARS" },
      "total": { "amount": "2469.00", "currency": "ARS" },
      "issue": null
    }
  ],
  "itemCount": 2,
  "subtotal": { "amount": "2469.00", "currency": "ARS" },
  "hasIssues": false
}
```

Amounts are decimal strings from `PricingService`, recomputed on every request (including USD conversion).
Subtotal excludes shipping; coupons are not implemented. If any line cannot be priced in ARS, `total` and
`subtotal` are null; an unknown line is never silently excluded from a partial subtotal. Known prices of lines with
insufficient stock remain in the subtotal, with `hasIssues: true`. `itemCount` sums requested quantities, including
lines with issues. `availableQuantity` is physical stock minus reservations, never negative.

`issue`: `UNAVAILABLE` (archived/unpublished/inactive), `NO_PRICE`, `NO_EXCHANGE_RATE` (USD without a current rate),
`INSUFFICIENT_STOCK`, or null. Existing lines stay visible with their issue so the buyer can fix/remove them.

**Shared errors**

- `401 Unauthorized`: `{ "statusCode": 401, "message": "Unauthorized" }` — expired/invalid session.
- `409 Conflict`: `{ "statusCode": 409, "message": "Another change was saved at the same time. Try again", "error": "Conflict" }` — write conflict; retry.
- `429 Too Many Requests`: `{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }` — wait before retrying.

### GET /cart

Reads the current cart; recomputes prices and availability. **Auth required:** No (optional session).
No body. Does not create a cart/cookie just because a visitor opens the store. A stale guest token is cleared.

`200 OK` — Cart response above, or empty:

```json
{ "items": [], "itemCount": 0, "subtotal": { "amount": "0.00", "currency": "ARS" }, "hasIssues": false }
```

Errors: shared `401`, `409`, `429` above.

### POST /cart/items

Adds a variant; repeated adds increase its quantity. Creates a cart on first add. **Auth required:** No (optional session).

| Field       | Type    | Required | Constraints                                            |
| ----------- | ------- | -------- | ------------------------------------------------------ |
| `variantId` | integer | yes      | 1–2,147,483,647                                        |
| `quantity`  | integer | yes      | 1–1,000,000; resulting quantity must fit current stock |

```json
{ "variantId": 12, "quantity": 2 }
```

`200 OK` — Cart response above. Adding a draft, inactive variant, missing price/rate or quantity exceeding available
stock is rejected; no reservation is created. Failure rolls back cart creation/merge and the item change together.

- `400 Bad Request`: `{ "statusCode": 400, "message": ["quantity must not be less than 1"], "error": "Bad Request" }` — invalid input or unknown properties.
- `404 Not Found`: `{ "statusCode": 404, "message": "Product variant not found", "error": "Not Found" }`.
- `422 Unprocessable Entity`: `{ "statusCode": 422, "message": "No hay stock suficiente para esa cantidad. Actualizá el carrito.", "error": "Unprocessable Entity" }`. Other reasons: unavailable product, missing price/rate or technical quantity limit.
- Shared `401`, `409`, `429` above.

### PATCH /cart/items/:variantId

Sets an existing line's absolute quantity. **Auth required:** No (optional session).
`variantId`: integer 1–2,147,483,647, scoped to the caller's cart.

| Field      | Type    | Required | Constraints |
| ---------- | ------- | -------- | ----------- |
| `quantity` | integer | yes      | 1–1,000,000 |

```json
{ "quantity": 3 }
```

`200 OK` — Cart response above with the updated line. Increasing requires a valid purchasable line and stock.
Reducing is allowed even if the line is currently unavailable or still exceeds stock; its issue remains visible.
To remove a line, use DELETE (zero is not an update quantity).

- `400 Bad Request`: `{ "statusCode": 400, "message": ["quantity must be an integer number"], "error": "Bad Request" }`.
- `404 Not Found`: `{ "statusCode": 404, "message": "Cart item not found", "error": "Not Found" }` — line is not in the caller's cart.
- `422 Unprocessable Entity`: same stock/price/availability errors as POST above.
- Shared `401`, `409`, `429` above.

### DELETE /cart/items/:variantId

Soft-removes a line. **Auth required:** No (optional session).
`variantId`: integer 1–2,147,483,647, scoped to the caller's cart. No body.

`200 OK` — Cart response above without the line; if it was the last line:

```json
{ "items": [], "itemCount": 0, "subtotal": { "amount": "0.00", "currency": "ARS" }, "hasIssues": false }
```

- `400 Bad Request`: `{ "statusCode": 400, "message": ["variantId must be an integer number"], "error": "Bad Request" }`.
- `404 Not Found`: `{ "statusCode": 404, "message": "Cart item not found", "error": "Not Found" }`.
- Shared `401`, `409`, `429` above.

### DELETE /cart

Soft-removes all lines from the caller's cart. **Auth required:** No (optional session). No body.
Already empty/missing carts also succeed without creating a cart.

`200 OK`:

```json
{ "items": [], "itemCount": 0, "subtotal": { "amount": "0.00", "currency": "ARS" }, "hasIssues": false }
```

Errors: shared `401`, `409`, `429` above.

## Guest orders and manual management

All responses below use `Cache-Control: private, no-store`. The API makes no outbound payment/email/shipping calls.
Money is in immutable ARS snapshots. Tracking returns full order lines as one aggregate, not a collection.
The private token is a bearer capability; redact request bodies containing `accessToken` in every proxy/logger.

### POST /cart/checkout/orders

Confirm the owner's reviewed cart in one transaction: reprice, lock stock, create snapshots/reservations/history,
convert the cart and assign `CG-` plus a padded numeric id. Status starts `PENDING_PAYMENT`, method `MANUAL`.

**Auth required:** No; same optional session and guest-cookie ownership as preview. Invalid sessions return 401.

**Request body**

| Field             | Type   | Required           | Constraints                                                                                             |
| ----------------- | ------ | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `name`            | string | Yes                | Trimmed/nonempty, max 200                                                                               |
| `email`           | string | Yes                | Valid email, trimmed, max 191                                                                           |
| `phone`           | string | No                 | Trimmed, max 30                                                                                         |
| `deliveryMethod`  | enum   | Yes                | Available `STORE_PICKUP` or configured `LOCAL_DELIVERY`; carrier unavailable                            |
| `shippingAddress` | object | For local delivery | Same nested fields/limits as preview; Rosario, Santa Fe                                                 |
| `reviewToken`     | string | Yes                | 64 lowercase hex characters from the exact preview being confirmed                                      |
| `accessToken`     | string | Yes                | 64 lowercase hex characters, generated from 32 secure random bytes before first POST; reused on retries |

Amounts, ownership, payment method and status cannot be supplied. An existing token returns its original order,
without another stock/payment operation and without requiring the now-converted cart cookie. Token possession grants
access; generate it cryptographically, never from an order number, email or timestamp.

```json
{
  "name": "Cliente de prueba",
  "email": "cliente@example.test",
  "deliveryMethod": "STORE_PICKUP",
  "reviewToken": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "accessToken": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

Tokens above are placeholders, not usable checkout credentials. `reviewToken` in preview changes when the reviewed
lines, names, prices, contact, address or shipping changes. `reservationHours` is the configured window (default 24).

**Responses**

`200 OK` — newly placed order or idempotent recovery (sample product/data):

```json
{
  "id": 123,
  "number": "CG-000123",
  "status": "PENDING_PAYMENT",
  "deliveryMethod": "STORE_PICKUP",
  "paymentMethod": "MANUAL",
  "subtotal": { "amount": "12.35", "currency": "ARS" },
  "shippingTotal": { "amount": "0.00", "currency": "ARS" },
  "total": { "amount": "12.35", "currency": "ARS" },
  "placedAt": "2026-10-05T18:00:00.000Z",
  "expiresAt": "2026-10-06T18:00:00.000Z",
  "customer": { "name": "Cliente de prueba", "email": "cliente@example.test", "phone": null },
  "shippingAddress": null,
  "items": [
    {
      "name": "Producto de prueba",
      "variantName": null,
      "sku": "TEST",
      "quantity": 1,
      "unitPrice": { "amount": "12.35", "currency": "ARS" },
      "total": { "amount": "12.35", "currency": "ARS" },
      "imageUrl": "http://localhost:3001/files/products/2026/10/foto.webp"
    }
  ],
  "history": [{ "status": "PENDING_PAYMENT", "at": "2026-10-05T18:00:00.000Z" }]
}
```

For local delivery, `shippingAddress` contains `street`, `streetNumber`, `city`, `province`, `postalCode`. Pickup
returns null. No secrets, actor ids, internal/staff notes or live catalog prices are returned. Each item's `imageUrl` is the
product's current first image (null without images): a thumbnail only, not part of the purchase snapshot.

`400 Bad Request` — invalid DTO/unknown fields: `{ "message": ["property total should not exist"], "statusCode": 400 }`.
`401 Unauthorized` — invalid optional session: `{ "message": "Unauthorized", "statusCode": 401 }`.
`409 Conflict` — stale review: `{ "message": "Tu compra cambió desde la revisión. Revisá los datos y el total de nuevo.", "statusCode": 409 }`.
`422 Unprocessable Entity` — empty cart, stock/price issue, unavailable delivery/invalid local destination or amount
outside Decimal(12,2) capacity: `{ "message": "El precio o el stock cambió. Revisá tu carrito.", "statusCode": 422 }`.
`429 Too Many Requests` — global browser limit: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

### POST /orders/:number/track

Read the immutable order and its current status/history with a private capability. Number must match `CG-` followed
by 6–10 digits. Number or email alone never grants access. Intended link: `/pedidos/CG-000123#acceso=<token>`.
The browser reads the fragment and sends the token in the body; servers never receive it as part of the page URL.

**Auth required:** No. Rate limit: 30/min/IP.

**Request body**

| Field         | Type   | Required | Constraints                                               |
| ------------- | ------ | -------- | --------------------------------------------------------- |
| `accessToken` | string | Yes      | 64 lowercase hexadecimal characters from the private link |

```json
{ "accessToken": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
```

**Responses**

`200 OK` — same complete order example above, with current status/history.
`400 Bad Request` — malformed number/token or unknown fields: `{ "message": ["accessToken must match /^[a-f0-9]{64}$/ regular expression"], "statusCode": 400 }`.
`404 Not Found` — missing order or wrong token, indistinguishable: `{ "message": "No encontramos un pedido con este enlace privado.", "statusCode": 404 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

### POST /orders/recover

Recover a lost confirmation response using the original pending attempt token, even without a cart cookie/number.
This is capability-based retry recovery, not public recovery by email. No new order/payment/reservation is created.

**Auth required:** No. Rate limit: 10/min/IP.

**Request body**

| Field         | Type   | Required | Constraints                                                             |
| ------------- | ------ | -------- | ----------------------------------------------------------------------- |
| `accessToken` | string | Yes      | Same 64-character lowercase hexadecimal token from the original attempt |

```json
{ "accessToken": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
```

**Responses**

`200 OK` — complete original order, same example as placement.
`400 Bad Request` — malformed/missing token: `{ "message": ["accessToken must match /^[a-f0-9]{64}$/ regular expression"], "statusCode": 400 }`.
`404 Not Found` — no completed attempt: `{ "message": "Todavía no encontramos una confirmación para este intento.", "statusCode": 404 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

### GET /orders/mine

The signed-in customer's own orders (`Order.userId`), latest id first, for the account area. Guest orders placed with
the same email are not linked: an email typed at checkout does not prove ownership. Wholesale company members only see
the orders they placed themselves.

**Auth required:** Yes (any role).

**Query**

| Field      | Type    | Required | Constraints        |
| ---------- | ------- | -------- | ------------------ |
| `page`     | integer | No       | 1–10000, default 1 |
| `pageSize` | integer | No       | 1–50, default 10   |

**Responses**

`200 OK` — `Cache-Control: private, no-store`. Each item has the same shape as the tracking response (no staff
fields):

```json
{
  "items": [{ "id": 12, "number": "CG-000012", "status": "PENDING_PAYMENT", "...": "..." }],
  "page": 1,
  "pageSize": 10,
  "total": 1,
  "totalPages": 1
}
```

`400 Bad Request` — `{ "message": ["pageSize must not be greater than 50"], "statusCode": 400 }`.
`401 Unauthorized` — no session: `{ "message": "Unauthorized", "statusCode": 401 }`.

### GET /orders/mine/:number

One of the signed-in customer's orders, same shape as tracking. Another account's or a guest order answers exactly like
a missing one.

**Auth required:** Yes (any role).

**Responses**

`200 OK` — `Cache-Control: private, no-store`; same complete order example as placement.
`400 Bad Request` — number not `CG-` + 6–10 digits: `{ "message": ["number must match /^CG-\\d{6,10}$/ regular expression"], "statusCode": 400 }`.
`401 Unauthorized` — no session: `{ "message": "Unauthorized", "statusCode": 401 }`.
`404 Not Found` — `{ "message": "No encontramos este pedido en tu cuenta.", "statusCode": 404 }`.

### GET /admin/orders

Paged orders, latest id first, optionally filtered by status, stage and a search term. Manual lifecycle only; all
original records are retained.

**Auth required:** Yes (ADMIN).

**Query**

| Field      | Type        | Required | Constraints                                                                                                                                                       |
| ---------- | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`     | integer     | No       | 1–10000, default 1                                                                                                                                                |
| `pageSize` | integer     | No       | 1–100, default 25                                                                                                                                                 |
| `status`   | OrderStatus | No       | One schema enum value                                                                                                                                             |
| `stage`    | string      | No       | `PENDING_PAYMENT` (pending or under review), `TO_FULFILL` (confirmed, preparing), `READY` (ready for pickup, shipped) or `CLOSED` (delivered, cancelled, expired) |
| `q`        | string      | No       | Max 100, trimmed. Partial match on order number, contact email or customer name                                                                                   |

**Responses**

`200 OK` — each `items` entry has the complete order shape shown above plus the admin fields: `allowedStatuses`
(e.g. `["CONFIRMED", "CANCELLED"]` for an unexpired pending order), `guest` (placed without an account) and, on each
`history` event, `note` and `by` (staff name; `null` for the system or the buyer). Tracking never includes them:

```json
{
  "guest": true,
  "history": [{ "status": "CANCELLED", "at": "2026-10-07T15:00:00.000Z", "note": "Pidió cancelar", "by": "Ana Pérez" }]
}
```

Example of an empty page:

```json
{ "items": [], "page": 1, "pageSize": 25, "total": 0, "totalPages": 0, "expiryJobFailed": false }
```

`expiryJobFailed` flags a persisted expiration failure or pending reservations overdue by over two minutes.
`400 Bad Request` — invalid query: `{ "message": ["page must not be less than 1"], "statusCode": 400 }`.
`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

### GET /admin/orders/counts

How many orders wait in each open stage, for the admin navigation badge and list views. Closed orders are not counted.

**Auth required:** Yes (ADMIN).

**Responses**

`200 OK`

```json
{ "PENDING_PAYMENT": 3, "TO_FULFILL": 5, "READY": 1 }
```

`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

### GET /admin/orders/:id

Read one order with the admin fields (`allowedStatuses`, `guest`, history `note` and `by`). Id is a positive integer.

**Auth required:** Yes (ADMIN).

**Responses**

`200 OK` — complete order example above plus `"allowedStatuses": ["CONFIRMED", "CANCELLED"]` for an unexpired
pending order. After expiry only cancellation is available until the job marks it expired; terminal states return [].
`400 Bad Request` — invalid id: `{ "message": ["id must not be less than 1"], "statusCode": 400 }`.
`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.
`404 Not Found`: `{ "message": "Pedido no encontrado.", "statusCode": 404 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

### PUT /admin/orders/:id/status

All existing-order state changes use `OrderStatusService.change`, with an order lock, validated transition, history,
stock movements and an atomic admin audit. Full payment confirmation creates one approved MANUAL Payment and consumes
reserved stock once. Cancellation is available only before payment confirmation; paid refunds remain out of scope.

**Auth required:** Yes (ADMIN).

**Request body**

| Field             | Type        | Required      | Constraints                                              |
| ----------------- | ----------- | ------------- | -------------------------------------------------------- |
| `status`          | OrderStatus | Yes           | Must be in server-derived allowedStatuses                |
| `paymentReceived` | boolean     | For CONFIRMED | Must be true; staff explicitly verified full payment     |
| `note`            | string      | No            | Max 255; internal history note, never returned to guests |

```json
{ "status": "CONFIRMED", "paymentReceived": true }
```

**Responses**

`200 OK` — complete order example above, now `"status": "CONFIRMED"`, with the new history event and
`"allowedStatuses": ["PREPARING"]`. Routes are pending→confirmed/cancelled→preparing→ready-for-pickup/shipped→delivered.
`EXPIRED` is job-only and cannot be requested by staff. A late payment cannot be confirmed even before the job runs.
`400 Bad Request` — malformed id/body: `{ "message": ["paymentReceived must be equal to true"], "statusCode": 400 }`.
`401 Unauthorized`: `{ "message": "Unauthorized", "statusCode": 401 }`.
`403 Forbidden`: `{ "message": "Forbidden resource", "statusCode": 403 }`.
`404 Not Found`: `{ "message": "Pedido no encontrado.", "statusCode": 404 }`.
`422 Unprocessable Entity` — invalid/repeated transition, missing payment verification, expired payment window or
inconsistent stock: `{ "message": "Verificá el pago antes de confirmar el pedido.", "statusCode": 422 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

## Store activity

### POST /activity

The store's browser reports what an **anonymous** visitor did, for the stats page. No account, IP or personal data is
stored: a visitor is a random UUID the browser keeps. Call it from the browser only (never from the front's server),
fire and forget. Rate limited to 60 requests per minute per IP.

**Auth required:** No.

**Request body**

| Field         | Type    | Required           | Constraints                                                                                    |
| ------------- | ------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `type`        | string  | Yes                | `VISIT` \| `PRODUCT_VIEW` \| `SEARCH` \| `ADD_TO_CART` \| `CHECKOUT_STARTED` \| `ORDER_PLACED` |
| `visitorId`   | string  | Yes                | UUID v4                                                                                        |
| `productId`   | integer | For product events | `PRODUCT_VIEW`, `ADD_TO_CART`; a published product                                             |
| `query`       | string  | For `SEARCH`       | 1–200 characters; stored trimmed, lowercased, single spaces, at most 100                       |
| `resultCount` | integer | For `SEARCH`       | 0–1,000,000: products the search found                                                         |

```json
{ "type": "PRODUCT_VIEW", "visitorId": "3f0c8a8e-2d1b-4c55-9a5e-6f1f2a7b9c10", "productId": 12 }
```

- `VISIT`: once per browser session (the front sends it on the first store page of a tab session).
- Requests whose `User-Agent` looks like a crawler, link preview or headless browser (or has none) answer `204` and
  store nothing.

**Responses**

`204 No Content`

`400 Bad Request`: `{ "message": ["productId must be an integer number"], "error": "Bad Request", "statusCode": 400 }`.
`404 Not Found`: `{ "message": "Product 999 not found", "error": "Not Found", "statusCode": 404 }`.
`429 Too Many Requests`: `{ "message": "ThrottlerException: Too Many Requests", "statusCode": 429 }`.

## Favorites

Saved products of the signed-in customer (any role). Guests have no favorites: the front asks them to sign in.
Browser-only; responses are `private, no-store`. At most 200 favorites per account (technical bound).

### GET /favorites

**Auth required:** Yes. `401` without a valid session.

`200 OK` — newest first, same card shape and buyer prices as `GET /products`. Products that are no longer visible in
the store (draft, archived, hidden out of stock) are left out, and come back if they are published again.

```json
{
  "items": [
    {
      "id": 3,
      "slug": "impresora-multifuncional-inalambrica-ecotank-l3250",
      "name": "Impresora Multifuncional Inalámbrica EcoTank L3250",
      "price": { "amount": "419999.00", "currency": "ARS" },
      "compareAtPrice": { "amount": "459999.00", "currency": "ARS" },
      "badge": "OFFER",
      "availability": "IN_STOCK"
    }
  ]
}
```

(Card fields shortened in the example; the full shape is the one documented in `GET /products`.)

### PUT /favorites/:productId

Save a product. Idempotent.

**Auth required:** Yes. `204 No Content`; `400` invalid id; `404` unknown or not visible product (`"Producto no
encontrado."`); `422` when the account already has 200 favorites.

### DELETE /favorites/:productId

Remove a product. Idempotent: removing one that is not saved also answers `204 No Content`.

**Auth required:** Yes.

## Frequent-customer applications

"Clientes frecuentes" in the UI; `wholesale` in code. A signed-in customer applies with their business data; staff
approve or reject it. While the company is `APPROVED` its members buy as `WHOLESALE` (prices from the company's list
or the default wholesale list). No documents yet: they need private storage (see business rules).

### GET /wholesale-applications/mine

**Auth required:** Yes. `private, no-store`.

`200 OK`

```json
{
  "application": {
    "id": 12,
    "status": "REJECTED",
    "message": "Compramos tintas todos los meses.",
    "reviewNote": "Falta la constancia de inscripción.",
    "createdAt": "2026-10-06T22:30:00.000Z",
    "reviewedAt": "2026-10-06T23:00:00.000Z",
    "company": {
      "id": 4,
      "legalName": "Imprenta de Prueba SRL",
      "tradeName": null,
      "cuit": "30712345671",
      "taxCondition": "RESPONSABLE_INSCRIPTO",
      "email": "compras@example.test",
      "phone": null,
      "wholesaleStatus": "REJECTED"
    }
  },
  "canApply": true,
  "blockReason": null
}
```

`application` is the latest one (null if the customer never applied). `canApply` is true without a company or after a
rejection; otherwise `blockReason` explains why (pending, approved, paused) in Spanish.

### POST /wholesale-applications

**Auth required:** Yes. Rate limit 10/min.

| Field          | Type   | Required | Constraints                                                          |
| -------------- | ------ | -------- | -------------------------------------------------------------------- |
| `legalName`    | string | Yes      | Trimmed, 2–200                                                       |
| `tradeName`    | string | No       | Max 200                                                              |
| `cuit`         | string | Yes      | 11 digits, dashes/spaces allowed; known prefix and valid check digit |
| `taxCondition` | enum   | Yes      | `RESPONSABLE_INSCRIPTO`, `MONOTRIBUTISTA`, `EXENTO`                  |
| `email`        | string | Yes      | Company contact email, max 191                                       |
| `phone`        | string | No       | Max 30                                                               |
| `message`      | string | No       | Max 1000; what the business does and buys                            |

`201 Created` — same shape as `GET /wholesale-applications/mine` (status `PENDING`). `400` invalid fields (e.g.
`CONSUMIDOR_FINAL`); `422` invalid CUIT check digit; `409` the customer cannot apply now (`blockReason`) or the CUIT
already belongs to another account (`"Ese CUIT ya tiene una cuenta. Si es tu empresa, consultá al local para
sumarte."` — the existing company is never revealed).

### GET /admin/wholesale-applications

**Auth required:** Yes (ADMIN). Query `page` (1–10000, default 1), `pageSize` (1–100, default 25), `status` (`PENDING`, `APPROVED`,
`REJECTED`, `PAUSED`) and `q` (max 100, trimmed: partial match on legal or trade name, company email, applicant name
or email, and the CUIT — `30-71234567` also matches the stored digits). Newest first. `400` invalid query.

`200 OK` — `{ items, page, pageSize, total, totalPages }`; each item is the application shape above plus
`submittedBy: { id, name, email }`, `reviewedBy: { id, name } | null`, `latest` (false when the company sent a newer
application) and `allowedDecisions` (subset of `approve`,
`reject`, `pause`, `resume`; empty for an application that is not the company's latest).

### GET /admin/wholesale-applications/counts

How many applications are in each status, for the list views and the admin navigation badge. Every application
counts, including those superseded by a newer one from the same company.

**Auth required:** Yes (ADMIN).

`200 OK`

```json
{ "PENDING": 2, "APPROVED": 14, "REJECTED": 3, "PAUSED": 1 }
```

`401 Unauthorized`, `403 Forbidden` (customers), `429 Too Many Requests`.

### GET /admin/wholesale-applications/:id

**Auth required:** Yes (ADMIN). `200 OK` — one item as in the list; `404` unknown id.

### POST /admin/wholesale-applications/:id/approve · /reject · /pause · /resume

**Auth required:** Yes (ADMIN, audited as `wholesale-application.<decision>`). Body `{ "note": "…" }` (max 500, shown
to the customer) — **required** for `reject` and `pause`.

| Decision  | From company status | To         |
| --------- | ------------------- | ---------- |
| `approve` | `PENDING`           | `APPROVED` |
| `reject`  | `PENDING`           | `REJECTED` |
| `pause`   | `APPROVED`          | `PAUSED`   |
| `resume`  | `PAUSED`            | `APPROVED` |

`200 OK` — the updated application (admin shape). `422` missing note, decision not allowed now, or not the company's
latest application. Approve/reject record an email to the applicant (`wholesale-approved` / `wholesale-rejected`;
logged until a mail provider exists).
