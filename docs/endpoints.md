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
