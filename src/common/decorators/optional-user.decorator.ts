import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AuthenticatedUser, RequestWithUser } from '../types/authenticated-user'

/** The user set by OptionalJwtAuthGuard, or undefined for anonymous visitors. */
export const OptionalUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<RequestWithUser>().user,
)
