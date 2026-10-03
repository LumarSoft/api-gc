import { UnauthorizedException } from '@nestjs/common'

/**
 * The refresh token was rotated a moment ago by another tab. The session is still valid (the browser already holds
 * the new cookies), so the controller must not clear them.
 */
export class RefreshRaceException extends UnauthorizedException {}
