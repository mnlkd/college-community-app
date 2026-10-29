import { uuidSchema } from '@hilcoe/shared'
import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { PROFILE_PICTURE_FIELD, type AccountService } from '../../identity/index.js'
import { NotFoundError, ValidationError } from '../../kernel/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import { MAX_IMAGE_BYTES } from '../image-processor.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

/** Reads one picture into memory; larger files are refused before Sharp sees them. */
function pictureUpload(): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
  }).single(PROFILE_PICTURE_FIELD)
  return (request, response, next) => {
    upload(request, response, (error: unknown) => {
      if (!error) return next()
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE' ? 'The image must be 5 MB or smaller.' : 'Send one image file.'
        return next(new ValidationError({ [PROFILE_PICTURE_FIELD]: message }))
      }
      next(error)
    })
  }
}

/** Manage Profile and Account, Change Account Email, Request Alumni Status, View Member Profile. */
export function membersRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  accounts: AccountService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { accounts, rateLimiter } = deps

  router.get(
    '/members/me',
    member,
    handle(async (_request, response) => {
      response.json(await accounts.getOwnAccount(actorOf(response)))
    }),
  )

  router.delete(
    '/members/me',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('account.delete', actor.accountId)
      await accounts.deleteOwnAccount(actor, request.body)
      response.status(204).end()
    }),
  )

  router.patch(
    '/members/me/profile',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('profile.update', actor.accountId)
      response.json(await accounts.updateProfile(actor, request.body))
    }),
  )

  router.put(
    '/members/me/profile-picture',
    member,
    (_request, response, next) => {
      try {
        rateLimiter.check('profile.picture', actorOf(response).accountId)
        next()
      } catch (error) {
        next(error)
      }
    },
    pictureUpload(),
    handle(async (request, response) => {
      if (!request.file) throw new ValidationError({ [PROFILE_PICTURE_FIELD]: 'Choose an image.' })
      response.json(await accounts.setProfilePicture(actorOf(response), request.file.buffer))
    }),
  )

  router.delete(
    '/members/me/profile-picture',
    member,
    handle(async (_request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('profile.picture', actor.accountId)
      response.json(await accounts.removeProfilePicture(actor))
    }),
  )

  router.put(
    '/members/me/email',
    member,
    handle(async (_request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('email.sync', actor.accountId)
      response.json(await accounts.syncEmail(actor))
    }),
  )

  router.get(
    '/members/me/graduation-requests',
    member,
    handle(async (_request, response) => {
      response.json(await accounts.listGraduationRequests(actorOf(response)))
    }),
  )

  router.post(
    '/members/me/graduation-requests',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      rateLimiter.check('graduation.request', actor.accountId)
      response.status(201).json(await accounts.requestGraduation(actor, request.body))
    }),
  )

  router.get(
    '/members/:memberId/profile',
    deps.auth.memberOrAdministrator(),
    handle(async (request, response) => {
      const memberId = uuidSchema.safeParse(request.params.memberId)
      if (!memberId.success) throw new NotFoundError('The profile was not found.')
      response.json(await accounts.getProfile(actorOf(response), memberId.data))
    }),
  )
  return router
}
