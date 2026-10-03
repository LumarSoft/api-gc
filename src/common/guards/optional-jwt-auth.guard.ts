import { ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { JwtAuthGuard } from './jwt-auth.guard'

/**
 * For public routes whose answer depends on who is asking (e.g. wholesale prices).
 * - No session: continues as an anonymous visitor.
 * - Valid session: attaches the user.
 * - Expired or invalid session: answers 401, so the client refreshes it and retries instead of silently getting
 *   anonymous prices. If the refresh fails, the API clears the cookies and the retry goes through as anonymous.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.extractToken(context.switchToHttp().getRequest<Request>())) return true
    return super.canActivate(context)
  }
}
