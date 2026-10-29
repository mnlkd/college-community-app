import { uuidSchema } from '@hilcoe/shared'
import { Router } from 'express'
import { NotFoundError } from '../../kernel/index.js'
import type { AuditService, ModerationService } from '../../moderation/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

function reportId(value: unknown): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new NotFoundError('The report was not found.')
  return parsed.data
}

/**
 * Report Content and the member's report history and consequences (FR-10, FR-14), and the
 * Administrator moderation queue, decisions and audit log (FR-13, NFR-7).
 */
export function moderationRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  moderation: ModerationService
  audit: AuditService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const administrator = deps.auth.administrator()
  const { moderation, audit, rateLimiter } = deps

  router.post(
    '/reports',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('report.submit', actor.accountId)
      response.status(201).json(await moderation.submitReport(actor, request.body))
    }),
  )

  router.get(
    '/reports/mine',
    member,
    handle(async (request, response) => {
      response.json(await moderation.listMyReports(actorOf(response), request.query))
    }),
  )

  router.get(
    '/consequences/mine',
    member,
    handle(async (_request, response) => {
      response.json(await moderation.listMyConsequences(actorOf(response)))
    }),
  )

  router.get(
    '/admin/reports',
    administrator,
    handle(async (request, response) => {
      response.json(await moderation.listReports(actorOf(response), request.query))
    }),
  )

  router.get(
    '/admin/reports/:reportId',
    administrator,
    handle(async (request, response) => {
      response.json(await moderation.getReport(actorOf(response), reportId(request.params.reportId)))
    }),
  )

  router.post(
    '/admin/reports/:reportId/decision',
    administrator,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = reportId(request.params.reportId)
      rateLimiter.check('report.decide', actor.accountId)
      response.json(await moderation.decideReport(actor, id, request.body))
    }),
  )

  router.get(
    '/admin/audit-records',
    administrator,
    handle(async (request, response) => {
      response.json(await audit.listAuditRecords(actorOf(response), request.query))
    }),
  )

  return router
}
