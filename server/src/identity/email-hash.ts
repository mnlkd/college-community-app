import { createHmac } from 'node:crypto'

/** HMAC-SHA-256 of the lower-case email with the server secret (NFR-8). */
export function hashEmail(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex')
}
