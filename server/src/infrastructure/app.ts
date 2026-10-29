import { randomUUID } from 'node:crypto'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import type { Container } from './container.js'
import { analyticsRoutes } from './routes/analytics-routes.js'
import { accountsRoutes } from './routes/accounts-routes.js'
import { adminRoutes } from './routes/admin-routes.js'
import { boardsRoutes } from './routes/boards-routes.js'
import { groupsRoutes } from './routes/groups-routes.js'
import { healthRoutes } from './routes/health-routes.js'
import { membersRoutes } from './routes/members-routes.js'
import { mentorshipRoutes } from './routes/mentorship-routes.js'
import { moderationRoutes } from './routes/moderation-routes.js'
import { notificationsRoutes } from './routes/notifications-routes.js'
import { opportunitiesRoutes } from './routes/opportunities-routes.js'
import { publishingRoutes } from './routes/publishing-routes.js'
import { registrationRoutes } from './routes/registration-routes.js'

/** Builds the Express application. The client is served by Vercel, which rewrites /api here. */
export function createApp(container: Container): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', container.config.trustProxy)
  app.set('query parser', 'simple')

  app.use(helmet())
  app.use(
    pinoHttp({
      logger: container.logger,
      genReqId: (_request, response) => {
        const id = randomUUID()
        response.setHeader('X-Request-Id', id)
        return id
      },
      serializers: {
        req: (request: { id: unknown; method: unknown; url?: string }) => ({
          id: request.id,
          method: request.method,
          path: request.url?.split('?')[0],
        }),
        res: (response: { statusCode: unknown }) => ({ statusCode: response.statusCode }),
      },
      autoLogging: { ignore: (request) => request.url === '/api/health' },
    }),
  )
  app.use(express.json({ limit: '100kb' }))
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  const api = express.Router()
  api.use(healthRoutes())
  api.use(accountsRoutes(container.auth))
  api.use(registrationRoutes(container))
  api.use(membersRoutes(container))
  api.use(notificationsRoutes(container))
  // Boards first: /posts/trending must match before /posts/:postId.
  api.use(boardsRoutes(container))
  api.use(publishingRoutes(container))
  api.use(mentorshipRoutes(container))
  api.use(opportunitiesRoutes(container))
  api.use(groupsRoutes(container))
  // Before adminRoutes, whose /admin guard would otherwise run first as well.
  api.use(moderationRoutes(container))
  api.use(analyticsRoutes(container))
  api.use(adminRoutes(container))
  api.use(container.errors.notFound())
  app.use('/api', api)

  app.use(container.errors.notFound())
  app.use(container.errors.middleware())
  return app
}
