import { describe, expect, it } from 'vitest'
import {
  commentInputSchema,
  normalizeTag,
  postEditInputSchema,
  postInputSchema,
  saveTargetFromPath,
  searchQuerySchema,
  tagSchema,
} from '@hilcoe/shared'

describe('Tag.normalize', () => {
  it('trims, removes one leading # and lower-cases', () => {
    expect(normalizeTag('  #SeniorProject ')).toBe('seniorproject')
    expect(normalizeTag('ai_ml-2026')).toBe('ai_ml-2026')
    expect(normalizeTag('ቴክኖሎጂ')).toBe('ቴክኖሎጂ')
  })

  it('accepts 1 to 30 letters, digits, hyphens or underscores only', () => {
    expect(normalizeTag('a'.repeat(30))).toBe('a'.repeat(30))
    expect(normalizeTag('a'.repeat(31))).toBeNull()
    expect(normalizeTag('#')).toBeNull()
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('two words')).toBeNull()
    expect(normalizeTag('##double')).toBeNull()
    expect(normalizeTag('c++')).toBeNull()
    expect(tagSchema.safeParse('bad tag').success).toBe(false)
  })
})

describe('PostInput', () => {
  it('is never empty', () => {
    const result = postInputSchema.safeParse({ body: '   ', tags: [], images: [] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['body'])
    expect(postInputSchema.safeParse({ body: null, images: [{ imageId: null }] }).success).toBe(true)
  })

  it('trims the text and rejects text over 10,000 characters', () => {
    expect(postInputSchema.parse({ body: '  hi  ' }).body).toBe('hi')
    expect(postInputSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false)
  })

  it('normalizes and de-duplicates tags, at most five distinct', () => {
    const post = postInputSchema.parse({ body: 'x', tags: ['#AI', 'ai', 'Ml', 'a', 'b', 'c'] })
    expect(post.tags).toEqual(['ai', 'ml', 'a', 'b', 'c'])
    expect(postInputSchema.safeParse({ body: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false)
  })

  it('allows at most four images with alt text of at most 250 characters', () => {
    const slot = { imageId: null, altText: 'A chart' }
    expect(postInputSchema.safeParse({ images: [slot, slot, slot, slot] }).success).toBe(true)
    expect(postInputSchema.safeParse({ images: [slot, slot, slot, slot, slot] }).success).toBe(false)
    expect(postInputSchema.safeParse({ images: [{ altText: 'x'.repeat(251) }] }).success).toBe(false)
    expect(postInputSchema.parse({ images: [{ altText: '  ' }] }).images[0]?.altText).toBeNull()
  })

  it('requires the version on edit', () => {
    expect(postEditInputSchema.safeParse({ body: 'x' }).success).toBe(false)
    expect(postEditInputSchema.parse({ body: 'x', version: 2 }).version).toBe(2)
  })
})

describe('CommentInput', () => {
  it('needs 1 to 2,000 characters after trimming', () => {
    expect(commentInputSchema.safeParse({ body: '  ' }).success).toBe(false)
    expect(commentInputSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false)
    expect(commentInputSchema.parse({ body: ' ok ' })).toEqual({ body: 'ok', parentCommentId: null })
  })
})

describe('SearchQuery', () => {
  it('needs a term or a tag and normalizes the tag', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false)
    expect(searchQuerySchema.parse({ tag: '#Career' })).toMatchObject({ tag: 'career', text: null, page: 1 })
    expect(searchQuerySchema.safeParse({ text: 'x'.repeat(201) }).success).toBe(false)
  })

  it('maps save target path segments', () => {
    expect(saveTargetFromPath('posts')).toBe('POST')
    expect(saveTargetFromPath('POST')).toBeNull()
  })
})
