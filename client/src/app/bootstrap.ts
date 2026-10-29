import type { QueryClient } from '@tanstack/react-query'
import { configureApi, createQueryClient } from '../api'
import { getAccessToken, onSignedOut, signOut, startSession } from '../auth'

/** Connects client.auth to client.api before the first render, so the first request has its token. */
export function bootstrap(): QueryClient {
  const queryClient = createQueryClient()
  configureApi({
    getAccessToken,
    onUnauthenticated: (error) => void signOut(error.message),
  })
  onSignedOut(() => queryClient.clear())
  startSession()
  return queryClient
}
