import type { ErrorBody } from '@hilcoe/shared'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { Prisma } from '../generated/prisma/client.js'
import {
  AppError,
  DependencyError,
  NotFoundError,
  RateLimitError,
  RestrictionError,
  ValidationError,
} from '../kernel/index.js'
import type { Logger } from './logger.js'

export interface ErrorResponse {
  status: number
  body: ErrorBody
  headers: Record<string, string>
}

const INTERNAL: ErrorBody = {
  error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again later.', fields: null },
}

/** Prisma errors meaning the database could not be reached or answered in time. */
const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028'])

/**
 * Last step of every request (ODD Table 5). AppErrors become their status and JSON body;
 * anything else becomes a generic 500 without details. Logs carry the error class, code
 * and stack but never request bodies, tokens or user content.
 */
export class ErrorHandler {
  constructor(private readonly logger: Logger) {}

  toResponse(error: unknown): ErrorResponse {
    const known = this.translate(error)
    if (!known) return { status: 500, body: INTERNAL, headers: {} }
    const body: ErrorBody = {
      error: {
        code: known.code,
        message: known.message,
        fields: known instanceof ValidationError ? known.fields : null,
      },
    }
    const headers: Record<string, string> = {}
    if (known instanceof RestrictionError) body.error.restrictedUntil = known.restrictedUntil.toISOString()
    if (known instanceof RateLimitError) {
      body.error.retryAfter = known.retryAfter
      headers['Retry-After'] = String(known.retryAfter)
    }
    return { status: known.httpStatus, body, headers }
  }

  middleware(): ErrorRequestHandler {
    return (error: unknown, request, response, next) => {
      if (response.headersSent) {
        next(error)
        return
      }
      const result = this.toResponse(error)
      const log = (request as { log?: Logger }).log ?? this.logger
      if (result.status >= 500) log.error({ err: error }, 'request failed')
      else log.info({ code: result.body.error.code }, 'request rejected')
      response.status(result.status).set(result.headers).json(result.body)
    }
  }

  /** Answers requests to unknown /api paths with 404 NOT_FOUND. */
  notFound(): RequestHandler {
    return (_request, _response, next) => next(new NotFoundError('There is no such endpoint.'))
  }

  private translate(error: unknown): AppError | null {
    if (error instanceof AppError) return error
    if (isBodyParserError(error)) {
      return error.type === 'entity.too.large'
        ? new ValidationError({ _: 'The request is too large.' })
        : new ValidationError({ _: 'The request body is not valid JSON.' })
    }
    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && UNAVAILABLE_CODES.has(error.code))
    ) {
      return new DependencyError(undefined, { cause: error })
    }
    return null
  }
}

function isBodyParserError(error: unknown): error is { type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    error.type.startsWith('entity.')
  )
}
