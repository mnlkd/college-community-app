import { z } from 'zod'

export const PAGE_SIZE_DEFAULT = 20
export const PAGE_SIZE_MAX = 50

/** Offset pagination: pages start at 1 and hold 1 to 50 items (default 20). */
export const pageRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
})

export type PageRequest = z.infer<typeof pageRequestSchema>

export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}
