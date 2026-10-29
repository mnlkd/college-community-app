import { Router } from 'express'
import type { RegistrationService } from '../../identity/index.js'
import { authUserOf, type AuthMiddleware } from '../auth-middleware.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

/** Register Account: called once Supabase Auth has accepted the email code. */
export function registrationRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  registrations: RegistrationService
}): Router {
  const router = Router()
  const guard = deps.auth.authUser()

  router.get(
    '/registrations/me',
    guard,
    handle(async (_request, response) => {
      response.json(await deps.registrations.getStatus(authUserOf(response)))
    }),
  )

  router.post(
    '/registrations',
    guard,
    handle(async (request, response) => {
      const authUser = authUserOf(response)
      deps.rateLimiter.check('registration', authUser.authUserId)
      response.status(201).json(await deps.registrations.completeRegistration(authUser, request.body))
    }),
  )
  return router
}
