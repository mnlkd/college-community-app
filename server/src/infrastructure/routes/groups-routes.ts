import { uuidSchema } from '@hilcoe/shared'
import { Router } from 'express'
import type { GroupService } from '../../groups/index.js'
import { NotFoundError, type ActorContext } from '../../kernel/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

function idParam(value: unknown, message: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new NotFoundError(message)
  return parsed.data
}

const groupId = (value: unknown) => idParam(value, 'The group was not found.')
const membershipId = (value: unknown) => idParam(value, 'The join request was not found.')
const transferId = (value: unknown) => idParam(value, 'The transfer was not found.')

type Decision = (actor: ActorContext, id: string) => Promise<void>

/**
 * Create or Close Group, Manage Group Membership and Transfer Group Ownership (FR-7). The
 * Activities Board is GET /api/boards/activities; saves go through /api/saved-items/groups/:id.
 */
export function groupsRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  groups: GroupService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { groups, rateLimiter } = deps

  router.post(
    '/groups',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('group.create', actor.accountId)
      response.status(201).json(await groups.createGroup(actor, request.body))
    }),
  )

  // Before /groups/:id.
  router.get(
    '/groups/mine',
    member,
    handle(async (request, response) => {
      response.json(await groups.listMyGroups(actorOf(response), request.query))
    }),
  )

  router.get(
    '/groups/:id',
    member,
    handle(async (request, response) => {
      response.json(await groups.getGroup(actorOf(response), groupId(request.params.id)))
    }),
  )

  router.put(
    '/groups/:id',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = groupId(request.params.id)
      rateLimiter.check('group.edit', actor.accountId)
      response.json(await groups.editGroup(actor, id, request.body))
    }),
  )

  router.post(
    '/groups/:id/closure',
    member,
    handle(async (request, response) => {
      await groups.closeGroup(actorOf(response), groupId(request.params.id))
      response.status(204).end()
    }),
  )

  router.post(
    '/groups/:id/memberships',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = groupId(request.params.id)
      rateLimiter.check('group.join', actor.accountId)
      response.status(201).json(await groups.requestJoin(actor, id))
    }),
  )

  router.delete(
    '/groups/:id/memberships/me',
    member,
    handle(async (request, response) => {
      await groups.withdrawJoin(actorOf(response), groupId(request.params.id))
      response.status(204).end()
    }),
  )

  router.post(
    '/groups/:id/departure',
    member,
    handle(async (request, response) => {
      await groups.leaveGroup(actorOf(response), groupId(request.params.id))
      response.status(204).end()
    }),
  )

  router.get(
    '/groups/:id/join-requests',
    member,
    handle(async (request, response) => {
      response.json(
        await groups.listJoinRequests(actorOf(response), groupId(request.params.id), request.query),
      )
    }),
  )

  const membershipDecisions: [string, Decision][] = [
    ['approval', (actor, id) => groups.approveJoin(actor, id)],
    ['decline', (actor, id) => groups.declineJoin(actor, id)],
  ]
  for (const [path, decide] of membershipDecisions) {
    router.post(
      `/group-memberships/:id/${path}`,
      member,
      handle(async (request, response) => {
        const actor = actorOf(response)
        const id = membershipId(request.params.id)
        rateLimiter.check('group.decide', actor.accountId)
        await decide(actor, id)
        response.status(204).end()
      }),
    )
  }

  router.post(
    '/groups/:id/transfers',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = groupId(request.params.id)
      rateLimiter.check('group.decide', actor.accountId)
      response.status(201).json(await groups.proposeTransfer(actor, id, request.body))
    }),
  )

  router.get(
    '/group-transfers/:id',
    member,
    handle(async (request, response) => {
      response.json(await groups.getTransfer(actorOf(response), transferId(request.params.id)))
    }),
  )

  const transferDecisions: [string, Decision][] = [
    ['acceptance', (actor, id) => groups.acceptTransfer(actor, id)],
    ['decline', (actor, id) => groups.declineTransfer(actor, id)],
    ['cancellation', (actor, id) => groups.cancelTransfer(actor, id)],
  ]
  for (const [path, decide] of transferDecisions) {
    router.post(
      `/group-transfers/:id/${path}`,
      member,
      handle(async (request, response) => {
        const actor = actorOf(response)
        const id = transferId(request.params.id)
        rateLimiter.check('group.decide', actor.accountId)
        await decide(actor, id)
        response.status(204).end()
      }),
    )
  }

  return router
}
