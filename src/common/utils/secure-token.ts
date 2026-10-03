import { createHash, randomBytes } from 'node:crypto'

/** High-entropy opaque token for links and refresh cookies. Only its hash is stored. */
export function generateSecureToken(): string {
  return randomBytes(48).toString('base64url')
}

/** SHA-256 is enough here: the tokens are random, so they cannot be brute-forced like passwords. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
