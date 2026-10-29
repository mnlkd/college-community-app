import { describe, expect, it } from 'vitest'
import {
  GROUP_OCCUPANCY_MAX,
  OPPORTUNITY_TITLE_MAX,
  boardFromPath,
  groupBoardQuerySchema,
  groupEditInputSchema,
  groupInputSchema,
  groupTransferInputSchema,
  myGroupsQuerySchema,
  opportunityBoardQuerySchema,
  opportunityEditInputSchema,
  opportunityInputSchema,
} from '@hilcoe/shared'

const listing = {
  title: '  Backend Intern  ',
  organization: 'Kifiya',
  location: 'Addis Ababa',
  type: 'INTERNSHIP',
  workArrangement: 'HYBRID',
  description: 'Build APIs.',
  applyVia: 'careers@example.com',
  deadline: '2026-08-01',
}

describe('OpportunityInput', () => {
  it('trims text and keeps a calendar deadline', () => {
    const parsed = opportunityInputSchema.parse(listing)
    expect(parsed.title).toBe('Backend Intern')
    expect(parsed.deadline).toBe('2026-08-01')
  })

  it('treats a blank or missing deadline as none', () => {
    expect(opportunityInputSchema.parse({ ...listing, deadline: '' }).deadline).toBeNull()
    expect(opportunityInputSchema.parse({ ...listing, deadline: undefined }).deadline).toBeNull()
    expect(opportunityInputSchema.parse({ ...listing, deadline: null }).deadline).toBeNull()
  })

  it('rejects a date-time, blank required text and text over the limit', () => {
    expect(opportunityInputSchema.safeParse({ ...listing, deadline: '2026-08-01T00:00:00Z' }).success).toBe(
      false,
    )
    expect(opportunityInputSchema.safeParse({ ...listing, applyVia: '   ' }).success).toBe(false)
    expect(
      opportunityInputSchema.safeParse({ ...listing, title: 'x'.repeat(OPPORTUNITY_TITLE_MAX + 1) }).success,
    ).toBe(false)
  })

  it('rejects unknown types and arrangements', () => {
    expect(opportunityInputSchema.safeParse({ ...listing, type: 'VOLUNTEER' }).success).toBe(false)
    expect(opportunityInputSchema.safeParse({ ...listing, workArrangement: 'ANY' }).success).toBe(false)
  })

  it('requires the version on edit', () => {
    expect(opportunityEditInputSchema.safeParse(listing).success).toBe(false)
    expect(opportunityEditInputSchema.safeParse({ ...listing, version: 2 }).success).toBe(true)
  })
})

describe('Opportunity board query', () => {
  it('reads filters and the mine flag from query strings', () => {
    const parsed = opportunityBoardQuerySchema.parse({
      text: ' go ',
      tag: '#Golang',
      type: 'FULL_TIME',
      workArrangement: 'REMOTE',
      mine: 'true',
      page: '2',
    })
    expect(parsed).toMatchObject({
      text: 'go',
      tag: 'golang',
      type: 'FULL_TIME',
      workArrangement: 'REMOTE',
      mine: true,
      page: 2,
    })
    expect(opportunityBoardQuerySchema.parse({}).mine).toBe(false)
  })
})

const group = {
  title: 'Study circle',
  description: 'Weekly algorithms practice, Saturdays 10:00.',
  maxOccupancy: 6,
  coordinationDetails: '  ',
}

describe('GroupInput', () => {
  it('turns blank coordination details into null', () => {
    expect(groupInputSchema.parse(group).coordinationDetails).toBeNull()
  })

  it('requires a whole maximum occupancy from 1 to the maximum', () => {
    for (const maxOccupancy of [0, -2, 2.5, GROUP_OCCUPANCY_MAX + 1, '6']) {
      expect(groupInputSchema.safeParse({ ...group, maxOccupancy }).success).toBe(false)
    }
    expect(groupInputSchema.safeParse({ ...group, maxOccupancy: 1 }).success).toBe(true)
  })

  it('requires the version on edit', () => {
    expect(groupEditInputSchema.safeParse(group).success).toBe(false)
    expect(groupEditInputSchema.safeParse({ ...group, version: 1 }).success).toBe(true)
  })

  it('reads board, my-groups and transfer inputs', () => {
    expect(groupBoardQuerySchema.parse({ tag: 'Chess' }).tag).toBe('chess')
    expect(myGroupsQuerySchema.parse({ relation: 'OWNER', state: 'OPEN' })).toMatchObject({
      relation: 'OWNER',
      state: 'OPEN',
    })
    expect(myGroupsQuerySchema.safeParse({ relation: 'ADMIN' }).success).toBe(false)
    expect(groupTransferInputSchema.safeParse({ memberId: 'nope' }).success).toBe(false)
  })
})

describe('Boards', () => {
  it('maps every board path', () => {
    expect(boardFromPath('opportunities')).toBe('OPPORTUNITIES')
    expect(boardFromPath('activities')).toBe('ACTIVITIES')
    expect(boardFromPath('mentorship')).toBe('MENTORSHIP')
  })
})
