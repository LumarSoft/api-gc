import { ExecutionContext, Injectable } from '@nestjs/common'
import { JwtAuthGuard } from './jwt-auth.guard'

/**
 * For public routes whose answer depends on who is asking (e.g. wholesale prices).
 * Attaches the user when the session is valid and lets anonymous requests through.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context)
    } catch {
      // No session or an expired one: continue as an anonymous visitor.
    }
    return true
  }
}
