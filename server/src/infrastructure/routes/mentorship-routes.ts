import { uuidSchema } from '@hilcoe/shared'
import { Router } from 'express'
import { NotFoundError } from '../../kernel/index.js'
import type { MentorshipService } from '../../mentorship/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

function idParam(value: unknown, message: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new NotFoundError(message)
  return parsed.data
}

const mentorId = (value: unknown) => idParam(value, 'The mentor was not found.')
const mentorshipId = (value: unknown) => idParam(value, 'The mentorship was not found.')

/**
 * Manage Mentor Availability, Request or Withdraw Mentorship, Respond to Mentorship Request and
 * End Mentorship (FR-5). The Mentorship Board itself is GET /api/boards/mentorship.
 */
export function mentorshipRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  mentorship: MentorshipService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { mentorship, rateLimiter } = deps

  // Before /mentors/:mentorId.
  router.get(
    '/mentors/me',
    member,
    handle(async (_request, response) => {
      response.json(await mentorship.getOwnMentorSettings(actorOf(response)))
    }),
  )

  router.put(
    '/mentors/me',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('mentor.update', actor.accountId)
      response.json(await mentorship.updateMentorProfile(actor, request.body))
    }),
  )

  router.get(
    '/mentors/:mentorId',
    member,
    handle(async (request, response) => {
      response.json(await mentorship.getMentorProfile(actorOf(response), mentorId(request.params.mentorId)))
    }),
  )

  router.get(
    '/mentors/:mentorId/contacts',
    member,
    handle(async (request, response) => {
      response.json(await mentorship.getMentorContacts(actorOf(response), mentorId(request.params.mentorId)))
    }),
  )

  router.post(
    '/mentors/:mentorId/mentorships',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = mentorId(request.params.mentorId)
      rateLimiter.check('mentorship.request', actor.accountId)
      response.status(201).json(await mentorship.requestMentorship(actor, id, request.body))
    }),
  )

  router.get(
    '/mentorships',
    member,
    handle(async (request, response) => {
      response.json(await mentorship.listMyMentorships(actorOf(response), request.query))
    }),
  )

  router.get(
    '/mentorships/:mentorshipId',
    member,
    handle(async (request, response) => {
      response.json(
        await mentorship.getMentorship(actorOf(response), mentorshipId(request.params.mentorshipId)),
      )
    }),
  )

  router.post(
    '/mentorships/:mentorshipId/acceptance',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const id = mentorshipId(request.params.mentorshipId)
      rateLimiter.check('mentorship.decide', actor.accountId)
      response.json(await mentorship.acceptRequest(actor, id))
    }),
  )

  const transitions = [
    ['decline', (actor, id) => mentorship.declineRequest(actor, id)],
    ['withdrawal', (actor, id) => mentorship.withdrawRequest(actor, id)],
    ['end', (actor, id) => mentorship.endMentorship(actor, id)],
  ] as const satisfies readonly (readonly [
    string,
    (actor: ReturnType<typeof actorOf>, id: string) => Promise<void>,
  ])[]

  for (const [path, change] of transitions) {
    router.post(
      `/mentorships/:mentorshipId/${path}`,
      member,
      handle(async (request, response) => {
        const actor = actorOf(response)
        const id = mentorshipId(request.params.mentorshipId)
        rateLimiter.check('mentorship.decide', actor.accountId)
        await change(actor, id)
        response.status(204).end()
      }),
    )
  }
  return router
}
