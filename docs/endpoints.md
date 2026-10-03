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
