import { POST_IMAGES_FIELD, POST_IMAGES_MAX, POST_JSON_FIELD, uuidSchema } from '@hilcoe/shared'
import { Router, type Request, type RequestHandler } from 'express'
import multer from 'multer'
import { NotFoundError, ValidationError } from '../../kernel/index.js'
import type { InteractionService, PublishingService } from '../../publishing/index.js'
import { actorOf, type AuthMiddleware } from '../auth-middleware.js'
import { MAX_IMAGE_BYTES } from '../image-processor.js'
import type { RateLimiter } from '../rate-limiter.js'
import { handle } from './handle.js'

/** Large enough for 10,000 characters of text plus tags and alt text in UTF-8. */
const POST_FIELD_BYTES = 128 * 1024

/**
 * Reads a multipart post: the JSON "post" field and up to four "images" files in memory. Larger
 * files are refused before Sharp sees them. A JSON request without images passes through.
 */
function postUpload(): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_IMAGE_BYTES,
      files: POST_IMAGES_MAX,
      fields: 1,
      fieldSize: POST_FIELD_BYTES,
      parts: POST_IMAGES_MAX + 1,
    },
  }).array(POST_IMAGES_FIELD, POST_IMAGES_MAX)
  return (request, response, next) => {
    upload(request, response, (error: unknown) => {
      if (!error) return next()
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Each image must be 5 MB or smaller.'
            : `Send the post and at most ${POST_IMAGES_MAX} images.`
        return next(new ValidationError({ [POST_IMAGES_FIELD]: message }))
      }
      next(error)
    })
  }
}

/** The post input and files of a multipart or JSON request. */
function postParts(request: Request): { input: unknown; files: Uint8Array[] } {
  if (!request.is('multipart/form-data')) return { input: request.body, files: [] }
  const raw: unknown = (request.body as Record<string, unknown> | undefined)?.[POST_JSON_FIELD]
  let input: unknown
  try {
    input = typeof raw === 'string' ? JSON.parse(raw) : undefined
  } catch {
    input = undefined
  }
  if (input === undefined) throw new ValidationError({ [POST_JSON_FIELD]: 'Send the post as JSON.' })
  const files = Array.isArray(request.files) ? request.files.map((file) => file.buffer) : []
  return { input, files }
}

function idParam(value: unknown, what: 'post' | 'comment'): string {
  const id = uuidSchema.safeParse(value)
  if (!id.success) throw new NotFoundError(`The ${what} was not found.`)
  return id.data
}

/** Checks the rate limit before the upload is read. */
function limit(rateLimiter: RateLimiter, action: string): RequestHandler {
  return (_request, response, next) => {
    try {
      rateLimiter.check(action, actorOf(response).accountId)
      next()
    } catch (error) {
      next(error)
    }
  }
}

/** Manage Own Post, Manage Own Comment, View Post Details, Like or Unlike Content (FR-3, FR-4, FR-15 to FR-19). */
export function publishingRoutes(deps: {
  auth: AuthMiddleware
  rateLimiter: RateLimiter
  publishing: PublishingService
  interactions: InteractionService
}): Router {
  const router = Router()
  const member = deps.auth.member()
  const { publishing, interactions, rateLimiter } = deps

  router.post(
    '/posts',
    member,
    limit(rateLimiter, 'post.create'),
    postUpload(),
    handle(async (request, response) => {
      const { input, files } = postParts(request)
      response.status(201).json(await publishing.createPost(actorOf(response), input, files))
    }),
  )

  router.get(
    '/posts/:postId',
    member,
    handle(async (request, response) => {
      response.json(await publishing.getPost(actorOf(response), idParam(request.params.postId, 'post')))
    }),
  )

  router.put(
    '/posts/:postId',
    member,
    limit(rateLimiter, 'post.edit'),
    postUpload(),
    handle(async (request, response) => {
      const postId = idParam(request.params.postId, 'post')
      const { input, files } = postParts(request)
      response.json(await publishing.editPost(actorOf(response), postId, input, files))
    }),
  )

  router.delete(
    '/posts/:postId',
    member,
    handle(async (request, response) => {
      await publishing.deletePost(actorOf(response), idParam(request.params.postId, 'post'))
      response.status(204).end()
    }),
  )

  router.post(
    '/posts/:postId/views',
    member,
    handle(async (request, response) => {
      await interactions.recordView(actorOf(response), idParam(request.params.postId, 'post'))
      response.status(204).end()
    }),
  )

  router.get(
    '/posts/:postId/comments',
    member,
    handle(async (request, response) => {
      const postId = idParam(request.params.postId, 'post')
      response.json(await publishing.listComments(actorOf(response), postId, request.query))
    }),
  )

  router.post(
    '/posts/:postId/comments',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const postId = idParam(request.params.postId, 'post')
      rateLimiter.check('comment', actor.accountId)
      response.status(201).json(await publishing.createComment(actor, postId, request.body))
    }),
  )

  router.get(
    '/comments/:commentId',
    member,
    handle(async (request, response) => {
      const commentId = idParam(request.params.commentId, 'comment')
      response.json(await publishing.getComment(actorOf(response), commentId))
    }),
  )

  router.patch(
    '/comments/:commentId',
    member,
    handle(async (request, response) => {
      const actor = actorOf(response)
      const commentId = idParam(request.params.commentId, 'comment')
      rateLimiter.check('comment', actor.accountId)
      response.json(await publishing.editComment(actor, commentId, request.body))
    }),
  )

  router.delete(
    '/comments/:commentId',
    member,
    handle(async (request, response) => {
      await publishing.deleteComment(actorOf(response), idParam(request.params.commentId, 'comment'))
      response.status(204).end()
    }),
  )

  for (const [path, type, what] of [
    ['/posts/:id/likes', 'POST', 'post'],
    ['/comments/:id/likes', 'COMMENT', 'comment'],
  ] as const) {
    router.get(
      path,
      member,
      handle(async (request, response) => {
        const id = idParam(request.params.id, what)
        response.json(await interactions.listLikers(actorOf(response), type, id, request.query))
      }),
    )
    router.put(
      path,
      member,
      handle(async (request, response) => {
        const actor = actorOf(response)
        const id = idParam(request.params.id, what)
        rateLimiter.check('like', actor.accountId)
        response.json(await interactions.like(actor, type, id))
      }),
    )
    router.delete(
      path,
      member,
      handle(async (request, response) => {
        const actor = actorOf(response)
        const id = idParam(request.params.id, what)
        rateLimiter.check('like', actor.accountId)
        response.json(await interactions.unlike(actor, type, id))
      }),
    )
  }
  return router
}
