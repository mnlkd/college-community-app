import { uuidSchema, type UnreadCountView } from '@hilcoe/shared'
import { Router } from 'express'
import { NotFoundError } from '../../kernel/index.js'
import type { NotificationService } from '../../notifications/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import { handle } from './handle.js'

/** Read Notifications (FR-12). */
export function notificationsRoutes(deps: {
  auth: AuthMiddleware
  notifications: NotificationService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { notifications } = deps

  router.get(
    '/notifications',
    member,
    handle(async (request, response) => {
      response.json(await notifications.listNotifications(actorOf(response), request.query))
    }),
  )

  router.get(
    '/notifications/unread-count',
    member,
    handle(async (_request, response) => {
      const view: UnreadCountView = { count: await notifications.countUnread(actorOf(response)) }
      response.json(view)
    }),
  )

  router.post(
    '/notifications/read-all',
    member,
    handle(async (_request, response) => {
      await notifications.markAllRead(actorOf(response))
      response.status(204).end()
    }),
  )

  router.post(
    '/notifications/:notificationId/read',
    member,
    handle(async (request, response) => {
      const id = uuidSchema.safeParse(request.params.notificationId)
      if (!id.success) throw new NotFoundError('The notice was not found.')
      await notifications.markRead(actorOf(response), id.data)
      response.status(204).end()
    }),
  )
  return router
}
