import { Router } from 'express'
import type { AnalyticsService } from '../../analytics/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

/** View Analytics and Export CSV (FR-11) and the Administrator queue counts (FR-12). */
export function analyticsRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  analytics: AnalyticsService
}): Router {
  const router = Router()
  const administrator = deps.auth.administrator()
  const { analytics, rateLimiter } = deps

  router.get(
    '/admin/analytics',
    administrator,
    handle(async (request, response) => {
      response.json(await analytics.getDashboard(actorOf(response), request.query))
    }),
  )

  router.get(
    '/admin/analytics/export.csv',
    administrator,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('analytics.export', actor.accountId)
      const file = await analytics.exportCsv(actor, request.query)
      response
        .status(200)
        .type('text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="${file.fileName}"`)
        .set('Cache-Control', 'no-store')
        .send(file.content)
    }),
  )

  router.get(
    '/admin/queue-counts',
    administrator,
    handle(async (_request, response) => {
      response.json(await analytics.getQueueCounts(actorOf(response)))
    }),
  )

  return router
}
