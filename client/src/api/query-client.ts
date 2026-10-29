import { QueryClient } from '@tanstack/react-query'
import { isApiError } from './http'

const RETRYABLE = new Set(['DEPENDENCY_UNAVAILABLE', 'INTERNAL_ERROR'])

/** Retries only transient failures; a 4xx answer will not change on retry. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false
  return !isApiError(error) || RETRYABLE.has(error.code)
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  })
}
