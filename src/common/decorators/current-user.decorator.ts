import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common'
import type { AuthenticatedUser, RequestWithUser } from '../types/authenticated-user'

/** Injects the user set by JwtAuthGuard. Only use on routes protected by that guard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<RequestWithUser>()
  // A route using @CurrentUser() without JwtAuthGuard is a programming error, not a client error.
  if (!request.user) throw new InternalServerErrorException()
  return request.user
})
