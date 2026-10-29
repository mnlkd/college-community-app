import { ERROR_STATUS, type ErrorCode, type FieldErrors } from '@hilcoe/shared'

/** Base class of all expected failures (ODD Table 6). */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode

  get httpStatus(): number {
    return ERROR_STATUS[this.code]
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED' as const

  constructor(
    readonly fields: FieldErrors,
    message = 'Some fields are not valid.',
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class AuthenticationError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const

  constructor(message = 'Sign in to continue.') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class PermissionDeniedError extends AppError {
  readonly code: 'FORBIDDEN' | 'RESTRICTED' = 'FORBIDDEN'

  constructor(message = 'You are not allowed to do this.') {
    super(message)
    this.name = 'PermissionDeniedError'
  }
}

export class RestrictionError extends PermissionDeniedError {
  override readonly code = 'RESTRICTED' as const

  constructor(
    readonly restrictedUntil: Date,
    message = 'Your account is restricted from this action until the restriction ends.',
  ) {
    super(message)
    this.name = 'RestrictionError'
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const

  constructor(message = 'The item was not found.') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  readonly code: 'CONFLICT' | 'CAPACITY_EXCEEDED' | 'DUPLICATE' = 'CONFLICT'

  constructor(message = 'The item has changed. Reload and try again.') {
    super(message)
    this.name = 'ConflictError'
  }
}

export class CapacityExceededError extends ConflictError {
  override readonly code = 'CAPACITY_EXCEEDED' as const

  constructor(message = 'The capacity has been reached.') {
    super(message)
    this.name = 'CapacityExceededError'
  }
}

export class DuplicateError extends ConflictError {
  override readonly code = 'DUPLICATE' as const

  constructor(message = 'This already exists.') {
    super(message)
    this.name = 'DuplicateError'
  }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const

  constructor(
    /** Seconds until the action is allowed again. */
    readonly retryAfter: number,
    message = 'Too many attempts. Try again later.',
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}

export class DependencyError extends AppError {
  readonly code = 'DEPENDENCY_UNAVAILABLE' as const

  constructor(message = 'A service is unavailable. Try again shortly.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'DependencyError'
  }
}
