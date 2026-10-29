import { describe, expect, it } from 'vitest'
import {
  MENTOR_CAPACITY_MAX,
  boardFromPath,
  mentorProfileInputSchema,
  mentorSearchQuerySchema,
  mentorshipListQuerySchema,
  mentorshipRequestInputSchema,
  topicAsTag,
} from '@hilcoe/shared'

const settings = {
  available: true,
  capacity: 2,
  introduction: '  Backend engineer.  ',
  topics: ['Backend APIs', 'Career advice'],
  contacts: [{ kind: 'EMAIL', value: ' Mentor@Example.com ' }],
}

describe('MentorProfileInput', () => {
  it('trims text and lower-cases an email contact', () => {
    const parsed = mentorProfileInputSchema.parse(settings)
    expect(parsed.introduction).toBe('Backend engineer.')
    expect(parsed.contacts).toEqual([{ kind: 'EMAIL', value: 'mentor@example.com' }])
  })

  it('turns a blank introduction into null', () => {
    expect(mentorProfileInputSchema.parse({ ...settings, introduction: '   ' }).introduction).toBeNull()
  })

  it('requires a whole capacity from 1 to the maximum', () => {
    for (const capacity of [0, -1, 1.5, MENTOR_CAPACITY_MAX + 1]) {
      expect(mentorProfileInputSchema.safeParse({ ...settings, capacity }).success).toBe(false)
    }
    expect(mentorProfileInputSchema.safeParse({ ...settings, capacity: MENTOR_CAPACITY_MAX }).success).toBe(
      true,
    )
  })

  it('requires at least one contact and one per kind', () => {
    expect(mentorProfileInputSchema.safeParse({ ...settings, contacts: [] }).success).toBe(false)
    const twice = [
      { kind: 'TELEGRAM', value: '@a' },
      { kind: 'TELEGRAM', value: '@b' },
    ]
    expect(mentorProfileInputSchema.safeParse({ ...settings, contacts: twice }).success).toBe(false)
  })

  it('checks email and phone values', () => {
    const bad = (kind: string, value: string) =>
      mentorProfileInputSchema.safeParse({ ...settings, contacts: [{ kind, value }] }).success
    expect(bad('EMAIL', 'not-an-email')).toBe(false)
    expect(bad('PHONE', 'call me')).toBe(false)
    expect(bad('PHONE', '+251 911 234 567')).toBe(true)
    expect(bad('OTHER', ' ')).toBe(false)
  })

  it('allows at most five distinct topics of at most 160 characters', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(mentorProfileInputSchema.safeParse({ ...settings, topics: six }).success).toBe(false)
    expect(mentorProfileInputSchema.safeParse({ ...settings, topics: ['x'.repeat(161)] }).success).toBe(false)
    expect(mentorProfileInputSchema.safeParse({ ...settings, topics: ['AI', 'ai'] }).success).toBe(false)
    expect(mentorProfileInputSchema.safeParse({ ...settings, topics: [' '] }).success).toBe(false)
  })
})

describe('MentorshipRequestInput', () => {
  it('requires a topic and a note within their limits', () => {
    expect(mentorshipRequestInputSchema.safeParse({ topic: 'AI', note: ' ' }).success).toBe(false)
    expect(mentorshipRequestInputSchema.safeParse({ topic: 'AI', note: 'x'.repeat(1001) }).success).toBe(
      false,
    )
    expect(mentorshipRequestInputSchema.parse({ topic: ' AI ', note: ' Hello ' })).toEqual({
      topic: 'AI',
      note: 'Hello',
    })
  })
})

describe('mentorship queries', () => {
  it('reads a comma-separated state list and a side', () => {
    expect(mentorshipListQuerySchema.parse({ side: 'MENTOR', state: 'PENDING,ACTIVE' })).toMatchObject({
      side: 'MENTOR',
      state: ['PENDING', 'ACTIVE'],
      page: 1,
    })
    expect(mentorshipListQuerySchema.parse({})).toMatchObject({ side: null, state: [] })
    expect(mentorshipListQuerySchema.safeParse({ state: 'OPEN' }).success).toBe(false)
  })

  it('normalizes a mentor search', () => {
    expect(mentorSearchQuerySchema.parse({ tag: '#Backend', openOnly: 'true' })).toMatchObject({
      tag: 'backend',
      openOnly: true,
      text: null,
      topic: null,
    })
    expect(mentorSearchQuerySchema.parse({}).openOnly).toBe(false)
  })

  it('writes a topic as a tag and maps board paths', () => {
    expect(topicAsTag('  Web   Development ')).toBe('web-development')
    expect(boardFromPath('mentorship')).toBe('MENTORSHIP')
    expect(boardFromPath('jobs')).toBeNull()
  })
})
