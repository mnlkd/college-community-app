import { isErrorBody, type ErrorCode, type FieldErrors } from '@hilcoe/shared'

/** A failed API call, typed from the server's ErrorBody (ODD Table 6). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields: FieldErrors | null = null,
    readonly restrictedUntil: string | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface HttpClientOptions {
  baseUrl?: string
  /** Returns the current access token, or null when signed out. */
  getAccessToken: () => Promise<string | null>
  /** Called once for every 401, after the error is built. */
  onUnauthenticated?: (error: ApiError) => void
  fetchImpl?: typeof fetch
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  signal?: AbortSignal
  /** 'file' resolves to a DownloadedFile instead of parsed JSON. */
  responseType?: 'json' | 'file'
}

/** A file response, such as the analytics CSV export. */
export interface DownloadedFile {
  blob: Blob
  /** From Content-Disposition, when the server names the file. */
  fileName: string | null
}

export type HttpClient = <T>(path: string, options?: RequestOptions) => Promise<T>

const NETWORK_MESSAGE = 'The service could not be reached. Check your connection and try again.'

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const baseUrl = options.baseUrl ?? '/api'
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  return async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const url = new URL(baseUrl + path, window.location.origin)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = {
      Accept: init.responseType === 'file' ? '*/*' : 'application/json',
    }
    const token = await options.getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    let body: BodyInit | undefined
    if (init.body instanceof FormData) body = init.body
    else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }

    let response: Response
    try {
      response = await fetchImpl(url, { method: init.method ?? 'GET', headers, body, signal: init.signal })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      throw new ApiError(0, 'DEPENDENCY_UNAVAILABLE', NETWORK_MESSAGE)
    }

    if (response.status === 204) return undefined as T
    if (response.ok && init.responseType === 'file') {
      const file: DownloadedFile = {
        blob: await response.blob(),
        fileName: fileNameOf(response.headers.get('Content-Disposition')),
      }
      return file as T
    }
    const payload: unknown = await response.json().catch(() => null)
    if (response.ok) return payload as T

    const error = toApiError(response.status, payload)
    if (error.status === 401) options.onUnauthenticated?.(error)
    throw error
  }
}

function fileNameOf(disposition: string | null): string | null {
  const match = disposition && /filename="([^"]+)"/.exec(disposition)
  return match ? (match[1] ?? null) : null
}

function toApiError(status: number, payload: unknown): ApiError {
  if (isErrorBody(payload)) {
    const { code, message, fields, restrictedUntil, retryAfter } = payload.error
    return new ApiError(status, code, message, fields, restrictedUntil ?? null, retryAfter ?? null)
  }
  if (status === 401) return new ApiError(status, 'UNAUTHENTICATED', 'Sign in to continue.')
  if (status >= 500)
    return new ApiError(status, status === 503 ? 'DEPENDENCY_UNAVAILABLE' : 'INTERNAL_ERROR', NETWORK_MESSAGE)
  return new ApiError(status, 'INTERNAL_ERROR', 'Something went wrong. Try again.')
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}
