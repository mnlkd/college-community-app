// Error codes and HTTP statuses of ODD Table 6. INTERNAL_ERROR is the generic 500
// answer for any exception that is not an AppError.
export const ERROR_STATUS = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  RESTRICTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CAPACITY_EXCEEDED: 409,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[]

/** Field path (dot-separated) to message. */
export type FieldErrors = Record<string, string>

export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    fields: FieldErrors | null
    /** ISO time; present only for RESTRICTED. */
    restrictedUntil?: string
    /** Seconds; present only for RATE_LIMITED. */
    retryAfter?: number
  }
}

export function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error: unknown }).error
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code in ERROR_STATUS &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}
