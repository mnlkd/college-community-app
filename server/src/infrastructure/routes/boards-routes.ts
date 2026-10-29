import { saveTargetFromPath, uuidSchema } from '@hilcoe/shared'
import { Router, type Request } from 'express'
import type { BoardsService } from '../../boards/index.js'
import { NotFoundError } from '../../kernel/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

function saveTarget(request: Request): { type: string; id: string } {
  const type = saveTargetFromPath(String(request.params.type))
  const id = uuidSchema.safeParse(request.params.id)
  if (!type || !id.success) throw new NotFoundError('The item was not found.')
  return { type, id: id.data }
}

/** Browse and Search Content, Save or Unsave Item (FR-8, FR-16, FR-18, FR-20). */
export function boardsRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  boards: BoardsService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { boards, rateLimiter } = deps

  router.get(
    '/posts',
    member,
    handle(async (request, response) => {
      response.json(await boards.listHomeFeed(actorOf(response), request.query))
    }),
  )

  router.get(
    '/posts/trending',
    member,
    handle(async (request, response) => {
      response.json(await boards.listTrending(actorOf(response), request.query))
    }),
  )

  router.get(
    '/search',
    member,
    handle(async (request, response) => {
      response.json(await boards.search(actorOf(response), request.query))
    }),
  )

  router.get(
    '/boards/:board',
    member,
    handle(async (request, response) => {
      response.json(await boards.listBoard(actorOf(response), String(request.params.board), request.query))
    }),
  )

  router.get(
    '/saved-items',
    member,
    handle(async (request, response) => {
      response.json(await boards.listSaved(actorOf(response), request.query))
    }),
  )

  router.put(
    '/saved-items/:type/:id',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const { type, id } = saveTarget(request)
      rateLimiter.check('save', actor.accountId)
      await boards.save(actor, type, id)
      response.status(204).end()
    }),
  )

  router.delete(
    '/saved-items/:type/:id',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const { type, id } = saveTarget(request)
      rateLimiter.check('save', actor.accountId)
      await boards.unsave(actor, type, id)
      response.status(204).end()
    }),
  )
  return router
}
