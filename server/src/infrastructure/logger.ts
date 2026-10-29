import { pino, type Logger } from 'pino'

/**
 * Structured logger. Request bodies are never logged and credentials are redacted,
 * so logs hold no passwords, codes, tokens or user content (NFR-8).
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.code',
      ],
      censor: '[redacted]',
    },
  })
}

export type { Logger }
