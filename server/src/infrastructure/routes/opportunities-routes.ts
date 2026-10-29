import { uuidSchema } from '@hilcoe/shared'
import { Router } from 'express'
import { NotFoundError } from '../../kernel/index.js'
import type { OpportunityService } from '../../opportunities/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

function opportunityId(value: unknown): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new NotFoundError('The opportunity was not found.')
  return parsed.data
}

/**
 * Manage Opportunity Listing (FR-6). The Opportunities Board is GET /api/boards/opportunities;
 * saves go through /api/saved-items/opportunities/:id.
 */
export function opportunitiesRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  opportunities: OpportunityService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { opportunities, rateLimiter } = deps

  router.post(
    '/opportunities',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('opportunity.create', actor.accountId)
      response.status(201).json(await opportunities.createOpportunity(actor, request.body))
    }),
  )

  router.get(
    '/opportunities/:id',
    member,
    handle(async (request, response) => {
      response.json(await opportunities.getOpportunity(actorOf(response), opportunityId(request.params.id)))
    }),
  )

  router.put(
    '/opportunities/:id',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = opportunityId(request.params.id)
      rateLimiter.check('opportunity.edit', actor.accountId)
      response.json(await opportunities.editOpportunity(actor, id, request.body))
    }),
  )

  router.post(
    '/opportunities/:id/closure',
    member,
    handle(async (request, response) => {
      await opportunities.closeOpportunity(actorOf(response), opportunityId(request.params.id))
      response.status(204).end()
    }),
  )

  return router
}
