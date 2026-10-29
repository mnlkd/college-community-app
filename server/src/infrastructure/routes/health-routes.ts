import { Router } from 'express'

/** Liveness probe for Render; touches no dependency. */
export function healthRoutes(): Router {
  const router = Router()
  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })
  return router
}
