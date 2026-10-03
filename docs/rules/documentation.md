# Documentation Rules

## Endpoint documentation

Every new endpoint must be documented in `docs/endpoints.md` in the same commit that introduces it. The frontend team
works from that file.

## Required fields per endpoint

- HTTP method and path
- Whether auth is required (and which role)
- Request body table (field, type, required, constraints) — if the endpoint accepts a body
- At least one success response with status code and example JSON
- All relevant error responses with status code and example JSON

## Format

Group endpoints by module (e.g. `## Auth`, `## Products`). Within each group, use `###` for individual endpoints.

Use the following structure for each endpoint:

```markdown
### METHOD /path

Short description of what the endpoint does.

**Auth required:** Yes (ADMIN) | No

**Request body**

| Field | Type | Required | Constraints |
| ----- | ---- | -------- | ----------- |
| ...   | ...  | ...      | ...         |

\`\`\`json
{ ... }
\`\`\`

**Responses**

\`STATUS Description\`
\`\`\`json
{ ... }
\`\`\`
```

## Other docs

- `STRUCTURE.md` is updated whenever a module or top-level folder is added.
- Business decisions that are not obvious from the code go in `docs/rules/business-rules.md`.

## What NOT to do

- Never merge an endpoint without its documentation entry.
- Never document an endpoint after the fact in a separate commit — keep code and docs together.
- Do not document internal helpers or private methods, only public HTTP routes.
