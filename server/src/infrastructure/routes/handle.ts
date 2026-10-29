import type { NextFunction, Request, RequestHandler, Response } from 'express'

/** Passes a rejected promise to the error handler. */
export function handle(work: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    work(request, response).catch(next)
  }
}
