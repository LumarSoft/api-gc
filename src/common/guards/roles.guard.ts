import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '../../generated/prisma/enums'
import { ROLES_KEY } from '../decorators/roles.decorator'
import type { RequestWithUser } from '../types/authenticated-user'

/** Must run after JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!roles?.length) return true

    const { user } = context.switchToHttp().getRequest<RequestWithUser>()
    if (!user || !roles.includes(user.role)) throw new ForbiddenException()
    return true
  }
}
