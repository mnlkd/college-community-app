import type { ActorContextView } from '@hilcoe/shared'
import { Router } from 'express'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'

/** Returns the caller's ActorContext: the one protected endpoint of each shell (Batch 0). */
export function accountsRoutes(auth: AuthMiddleware): Router {
  const router = Router()
  router.get('/accounts/me', auth.member(), (_request, response) => {
    const view: ActorContextView = actorOf(response).toView()
    response.json(view)
  })
  router.get('/admin/accounts/me', auth.administrator(), (_request, response) => {
    const view: ActorContextView = actorOf(response).toView()
    response.json(view)
  })
  return router
}
