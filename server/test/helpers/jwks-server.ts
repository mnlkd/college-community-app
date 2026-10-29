import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'

export interface TokenClaims {
  sub: string
  aal?: 'aal1' | 'aal2'
  sessionId?: string
  /** Sign-in time in seconds; becomes the amr claim. */
  authenticatedAt?: number
  expiresIn?: string
  issuer?: string
  audience?: string
}

/** A stand-in for the Supabase JWKS endpoint that signs ES256 tokens like Supabase does. */
export class JwksServer {
  private server: Server | null = null
  private privateKey: CryptoKey | null = null
  private jwk: JWK | null = null
  url = ''

  async start(): Promise<void> {
    const pair = await generateKeyPair('ES256', { extractable: true })
    this.privateKey = pair.privateKey
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' }
    this.server = createServer((request, response) => {
      if (request.url === '/auth/v1/.well-known/jwks.json') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ keys: [this.jwk] }))
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
  }

  sign(claims: TokenClaims, key: CryptoKey | null = this.privateKey): Promise<string> {
    const amr = claims.authenticatedAt
      ? [{ method: 'password', timestamp: claims.authenticatedAt }]
      : undefined
    return new SignJWT({
      aal: claims.aal ?? 'aal1',
      session_id: claims.sessionId,
      role: 'authenticated',
      amr,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(claims.issuer ?? `${this.url}/auth/v1`)
      .setAudience(claims.audience ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '1h')
      .sign(key!)
  }

  /** Signs with a key the server does not publish. */
  async signWithForeignKey(claims: TokenClaims): Promise<string> {
    const pair = await generateKeyPair('ES256')
    return this.sign(claims, pair.privateKey)
  }
}
