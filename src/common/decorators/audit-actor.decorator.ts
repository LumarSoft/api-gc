import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common'
import type { Request } from 'express'
import type { AuditActor } from '../types/audit-actor'
import type { RequestWithUser } from '../types/authenticated-user'

/** Who is making an admin change and from where, for the audit log. Only use on routes protected by JwtAuthGuard. */
export const CurrentAuditActor = createParamDecorator((_data: unknown, context: ExecutionContext): AuditActor => {
  const request = context.switchToHttp().getRequest<Request & RequestWithUser>()
  if (!request.user) throw new InternalServerErrorException()
  // request.ip honors TRUST_PROXY (see main.ts), so it is the client's address and not the proxy's.
  return { userId: request.user.id, ipAddress: request.ip?.slice(0, 45) ?? null }
})
