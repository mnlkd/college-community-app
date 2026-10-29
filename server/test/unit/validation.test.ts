import { pageRequestSchema, requiredText } from '@hilcoe/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseInput } from '../../src/kernel/index.js'
import { pageWindow, toPage, ValidationError } from '../../src/kernel/index.js'

describe('parseInput', () => {
  const schema = z.object({ title: requiredText(10), nested: z.object({ count: z.number().int() }) })

  it('returns parsed, trimmed data', () => {
    expect(parseInput(schema, { title: '  Hello ', nested: { count: 1 } })).toEqual({
      title: 'Hello',
      nested: { count: 1 },
    })
  })

  it('throws ValidationError naming each invalid field', () => {
    let error: unknown
    try {
      parseInput(schema, { title: '   ', nested: { count: 1.5 } })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ValidationError)
    expect(Object.keys((error as ValidationError).fields).sort()).toEqual(['nested.count', 'title'])
  })
})

describe('pagination', () => {
  it('maps a page request to skip and take', () => {
    const request = pageRequestSchema.parse({ page: '3', pageSize: '10' })
    expect(pageWindow(request)).toEqual({ skip: 20, take: 10 })
    expect(toPage([], request, 5)).toEqual({ items: [], page: 3, pageSize: 10, total: 5 })
  })
})
