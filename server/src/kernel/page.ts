import type { Page, PageRequest } from '@hilcoe/shared'

export type { Page, PageRequest }

/** Prisma skip/take for a page request; a page past the end simply returns no items. */
export function pageWindow(request: PageRequest): { skip: number; take: number } {
  return { skip: (request.page - 1) * request.pageSize, take: request.pageSize }
}

export function toPage<T>(items: T[], request: PageRequest, total: number): Page<T> {
  return { items, page: request.page, pageSize: request.pageSize, total }
}
