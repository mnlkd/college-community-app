import { createHttpClient, type ApiError, type HttpClient } from './http'

interface ApiWiring {
  getAccessToken: () => Promise<string | null>
  onUnauthenticated: (error: ApiError) => void
}

let wiring: ApiWiring = { getAccessToken: async () => null, onUnauthenticated: () => undefined }

/** client.app connects the session from client.auth here, so client.api does not depend on it. */
export function configureApi(next: ApiWiring): void {
  wiring = next
}

export const api: HttpClient = createHttpClient({
  getAccessToken: () => wiring.getAccessToken(),
  onUnauthenticated: (error) => wiring.onUnauthenticated(error),
})
