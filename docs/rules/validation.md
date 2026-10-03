# Validation Rules

## DTOs

- Every controller input (body, params, query) must have its own DTO class.
- DTOs live in a `dto/` folder inside the feature module.
- Use `class-validator` decorators to validate all fields.
- Always type the return value of service methods.
- Never trust client data without validation.

## Naming

- Input DTOs: `CreateProductDto`, `UpdateProductDto`, `LoginDto`, `RegisterDto`
- Output DTOs (when needed): `ProductResponseDto`
- Reuse with `PartialType` / `PickType` / `OmitType` from `@nestjs/mapped-types` (or `@nestjs/swagger` if added)
  instead of duplicating fields.

## Output DTOs

- When returning data that could contain sensitive fields, use an output DTO or explicitly select/exclude fields in
  the Prisma query.
- Do not rely on accidentally omitting fields — be explicit.

## Argentina-specific fields

- CUIT: 11 digits, validated with the official check digit — implement once in `src/common/` and reuse.
- Money in requests: validate as decimal strings (`@IsDecimal`) or integers in cents — never free floats.

## Example

```typescript
// dto/register.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator'

export class RegisterDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(8)
  password: string
}
```

## ValidationPipe

- `ValidationPipe` is configured globally in `main.ts` with:
  - `whitelist: true` — strips unknown properties
  - `forbidNonWhitelisted: true` — throws error on unknown properties
  - `transform: true` — auto-transforms types
