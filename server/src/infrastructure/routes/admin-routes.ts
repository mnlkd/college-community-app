import { uuidSchema } from '@hilcoe/shared'
import { Router } from 'express'
import type { AdminIdentityService } from '../../identity/index.js'
import { NotFoundError } from '../../kernel/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

/** A path id that is not a UUID cannot name anything the actor may see. */
function pathId(value: unknown, message: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new NotFoundError(message)
  return parsed.data
}

const MEMBER_NOT_FOUND = 'The account was not found.'
const ADMIN_NOT_FOUND = 'The Administrator was not found.'

/**
 * Administrator identity controls (AdminIdentityService, Batch 1b). Every route passes
 * AuthMiddleware.requireAdministrator through the administrator() guard.
 */
export function adminRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  adminIdentity: AdminIdentityService
}): Router {
  const router = Router()
  const { adminIdentity: service, rateLimiter } = deps
  router.use('/admin', deps.auth.administrator())

  // Users list and Manage User

  router.get(
    '/admin/members',
    handle(async (request, response) => {
      response.json(await service.listMembers(actorOf(response), request.query))
    }),
  )

  router.get(
    '/admin/members/:memberId',
    handle(async (request, response) => {
      const memberId = pathId(request.params.memberId, MEMBER_NOT_FOUND)
      response.json(await service.getMember(actorOf(response), memberId))
    }),
  )

  router.put(
    '/admin/members/:memberId/role',
    handle(async (request, response) => {
      const memberId = pathId(request.params.memberId, MEMBER_NOT_FOUND)
      await service.correctRole(actorOf(response), memberId, request.body)
      response.status(204).end()
    }),
  )

  router.put(
    '/admin/members/:memberId/email',
    handle(async (request, response) => {
      const actor = actorOf(response)
      const memberId = pathId(request.params.memberId, MEMBER_NOT_FOUND)
      rateLimiter.check('admin.memberEmail', actor.accountId)
      await service.updateMemberEmail(actor, memberId, request.body)
      response.status(204).end()
    }),
  )

  router.post(
    '/admin/members/:memberId/disable',
    handle(async (request, response) => {
      const memberId = pathId(request.params.memberId, MEMBER_NOT_FOUND)
      await service.disableAccount(actorOf(response), memberId, request.body)
      response.status(204).end()
    }),
  )

  router.post(
    '/admin/members/:memberId/restore',
    handle(async (request, response) => {
      const memberId = pathId(request.params.memberId, MEMBER_NOT_FOUND)
      await service.restoreAccount(actorOf(response), memberId, request.body)
      response.status(204).end()
    }),
  )

  router.delete(
    '/admin/members/:memberId',
    handle(async (request, response) => {
      const memberId = pathId(request.params.memberId, MEMBER_NOT_FOUND)
      await service.deleteFakeAccount(actorOf(response), memberId, request.body)
      response.status(204).end()
    }),
  )

  // Review Alumni Affiliation and Confirm Graduation

  router.get(
    '/admin/alumni-reviews',
    handle(async (request, response) => {
      response.json(await service.listAlumniReviews(actorOf(response), request.query))
    }),
  )

  router.post(
    '/admin/alumni-reviews/:reviewId/decision',
    handle(async (request, response) => {
      const reviewId = pathId(request.params.reviewId, 'The review was not found.')
      await service.reviewAlumni(actorOf(response), reviewId, request.body)
      response.status(204).end()
    }),
  )

  router.get(
    '/admin/graduation-requests',
    handle(async (request, response) => {
      response.json(await service.listGraduationRequests(actorOf(response), request.query))
    }),
  )

  router.post(
    '/admin/graduation-requests/:requestId/decision',
    handle(async (request, response) => {
      const requestId = pathId(request.params.requestId, 'The graduation request was not found.')
      await service.decideGraduation(actorOf(response), requestId, request.body)
      response.status(204).end()
    }),
  )

  // Maintain Staff Email List

  router.get(
    '/admin/staff-emails',
    handle(async (request, response) => {
      response.json(await service.listStaffEmails(actorOf(response), request.query))
    }),
  )

  router.post(
    '/admin/staff-emails',
    handle(async (request, response) => {
      response.status(201).json(await service.addStaffEmail(actorOf(response), request.body))
    }),
  )

  router.delete(
    '/admin/staff-emails/:email',
    handle(async (request, response) => {
      await service.removeStaffEmail(actorOf(response), String(request.params.email))
      response.status(204).end()
    }),
  )

  // Create Administrator, Reset Administrator MFA, Remove Administrator

  router.get(
    '/admin/administrators',
    handle(async (_request, response) => {
      response.json(await service.listAdministrators(actorOf(response)))
    }),
  )

  router.post(
    '/admin/administrators',
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('admin.create', actor.accountId)
      response.status(201).json(await service.createAdministrator(actor, request.body))
    }),
  )

  router.put(
    '/admin/administrators/me/email',
    handle(async (_request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('admin.email.sync', actor.accountId)
      response.json(await service.syncOwnEmail(actor))
    }),
  )

  router.post(
    '/admin/administrators/:adminId/mfa-reset',
    handle(async (request, response) => {
      const adminId = pathId(request.params.adminId, ADMIN_NOT_FOUND)
      await service.resetAdministratorMfa(actorOf(response), adminId, request.body)
      response.status(204).end()
    }),
  )

  router.delete(
    '/admin/administrators/:adminId',
    handle(async (request, response) => {
      const adminId = pathId(request.params.adminId, ADMIN_NOT_FOUND)
      await service.removeAdministrator(actorOf(response), adminId, request.body)
      response.status(204).end()
    }),
  )

  return router
}
