import { describe, expect, it } from 'vitest'
import {
  AppError,
  AuthenticationError,
  CapacityExceededError,
  ConflictError,
  DependencyError,
  DuplicateError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  RestrictionError,
  ValidationError,
} from '../../src/kernel/index.js'

describe('AppError hierarchy (ODD Table 6)', () => {
  it.each([
    [new ValidationError({ a: 'x' }), 422, 'VALIDATION_FAILED'],
    [new AuthenticationError(), 401, 'UNAUTHENTICATED'],
    [new PermissionDeniedError(), 403, 'FORBIDDEN'],
    [new RestrictionError(new Date()), 403, 'RESTRICTED'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new CapacityExceededError(), 409, 'CAPACITY_EXCEEDED'],
    [new DuplicateError(), 409, 'DUPLICATE'],
    [new RateLimitError(30), 429, 'RATE_LIMITED'],
    [new DependencyError(), 503, 'DEPENDENCY_UNAVAILABLE'],
  ])('%s has status %i and code %s', (error, status, code) => {
    expect(error).toBeInstanceOf(AppError)
    expect(error.httpStatus).toBe(status)
    expect(error.code).toBe(code)
  })

  it('keeps the documented subclass relations', () => {
    expect(new RestrictionError(new Date())).toBeInstanceOf(PermissionDeniedError)
    expect(new CapacityExceededError()).toBeInstanceOf(ConflictError)
    expect(new DuplicateError()).toBeInstanceOf(ConflictError)
  })
})
