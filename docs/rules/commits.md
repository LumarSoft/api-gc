# Commit Conventions

## Format

Use Conventional Commits:

```
<type>: <short description in english, lowercase>
```

## Types

| Type       | When to use                                       |
| ---------- | ------------------------------------------------- |
| `feat`     | New feature or endpoint                           |
| `fix`      | Bug fix                                           |
| `refactor` | Code change that doesn't fix a bug or add feature |
| `chore`    | Tooling, dependencies, config changes             |
| `docs`     | Documentation only                                |
| `test`     | Adding or fixing tests                            |
| `perf`     | Performance improvement                           |

## Examples

```
feat: add wholesale application endpoint
fix: release stock when reservation expires
refactor: extract cuit validation to common helper
chore: add husky pre-commit hook
docs: document products endpoints
```

## Branches and PRs

- Branches: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`. Never push directly to `master`/`main`.
- Every change goes through a PR reviewed by another team member.
- One PR = one responsibility. PR title follows the same Conventional Commits format.
- If a PR includes a migration, say so in the description.

## Rules

- Never commit `console.log`, commented-out code, or debug artifacts.
- Never commit `.env` files or secrets.
- One commit = one responsibility. Do not mix features with refactors.
- Description in lowercase, no period at the end.
