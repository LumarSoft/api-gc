# Error Handling Rules

## NestJS exceptions

Always use NestJS built-in exceptions. Never throw generic `Error` objects from request-handling code.

| Situation                          | Exception                      |
| ---------------------------------- | ------------------------------ |
| Resource not found                 | `NotFoundException`            |
| Duplicate / already exists         | `ConflictException`            |
| Invalid credentials / token        | `UnauthorizedException`        |
| Forbidden action                   | `ForbiddenException`           |
| Invalid input (not caught by DTO)  | `BadRequestException`          |
| Business rule violated (no stock…) | `UnprocessableEntityException` |
| External provider down             | `ServiceUnavailableException`  |
| Unexpected server error            | `InternalServerErrorException` |

## Async error handling

- Every `async` method must handle errors explicitly.
- Use `try/catch` for operations that can fail (external calls, complex DB operations).
- Let NestJS exceptions propagate naturally — do not wrap them in another try/catch.
- Failures in background jobs (Tango sync, reservation expiry) are logged with `Logger` and persisted as a status
  the admin can see — they never fail silently.

## What NOT to do

- Never expose stack traces or internal error messages to the client.
- Never throw plain `new Error('something')` from controllers or services — always use NestJS exceptions.
- Never swallow errors silently with an empty `catch` block.

## Example

```typescript
async findOne(id: number): Promise<ProductResponseDto> {
  const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } })
  if (!product) throw new NotFoundException(`Product with id ${id} not found`)
  return product
}
```
