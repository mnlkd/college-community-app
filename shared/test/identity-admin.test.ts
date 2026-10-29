import { describe, expect, it } from 'vitest'
import {
  administratorInputSchema,
  adminMemberQuerySchema,
  alumniDecisionInputSchema,
  graduationDecisionInputSchema,
  memberEmailUpdateInputSchema,
  reasonInputSchema,
  roleCorrectionInputSchema,
  staffEmailInputSchema,
} from '@hilcoe/shared'

describe('Administrator identity inputs', () => {
  it('requires a trimmed private reason of at most 1000 characters and never truncates', () => {
    expect(reasonInputSchema.parse({ reason: '  checked in person  ' })).toEqual({
      reason: 'checked in person',
    })
    expect(reasonInputSchema.safeParse({ reason: '   ' }).success).toBe(false)
    expect(reasonInputSchema.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false)
    expect(reasonInputSchema.safeParse({}).success).toBe(false)
  })

  it('offers only final decisions: uncertain Alumni cases stay pending', () => {
    expect(alumniDecisionInputSchema.safeParse({ decision: 'PENDING', reason: 'r' }).success).toBe(false)
    expect(alumniDecisionInputSchema.safeParse({ decision: 'VERIFIED', reason: 'r' }).success).toBe(true)
    expect(graduationDecisionInputSchema.safeParse({ decision: 'PENDING', reason: 'r' }).success).toBe(false)
    expect(graduationDecisionInputSchema.safeParse({ decision: 'DECLINED', reason: 'r' }).success).toBe(true)
  })

  it('accepts only lower-cased college emails for the Staff list and Administrators', () => {
    expect(staffEmailInputSchema.parse({ email: ' Abebe@HiLCoESchool.com ' })).toEqual({
      email: 'abebe@hilcoeschool.com',
    })
    expect(staffEmailInputSchema.safeParse({ email: 'abebe@gmail.com' }).success).toBe(false)
    expect(administratorInputSchema.safeParse({ email: 'admin@gmail.com' }).success).toBe(false)
    expect(administratorInputSchema.safeParse({ email: 'new.admin@hilcoeschool.com' }).success).toBe(true)
  })

  it('needs an Alumni status only for an Alumni result', () => {
    const reason = 'corroborated'
    expect(roleCorrectionInputSchema.safeParse({ newRole: 'ALUMNI', reason }).success).toBe(false)
    expect(
      roleCorrectionInputSchema.safeParse({ newRole: 'ALUMNI', alumniStatus: 'FLAGGED', reason }).success,
    ).toBe(false)
    expect(
      roleCorrectionInputSchema.parse({ newRole: 'ALUMNI', alumniStatus: 'SELF_REPORTED', reason }),
    ).toEqual({ newRole: 'ALUMNI', alumniStatus: 'SELF_REPORTED', reason })
    expect(
      roleCorrectionInputSchema.safeParse({ newRole: 'STAFF', alumniStatus: 'VERIFIED', reason }).success,
    ).toBe(false)
    expect(roleCorrectionInputSchema.parse({ newRole: 'STAFF', reason })).toEqual({
      newRole: 'STAFF',
      alumniStatus: null,
      reason,
    })
  })

  it('lower-cases a replacement member email of any domain', () => {
    expect(memberEmailUpdateInputSchema.parse({ newEmail: 'Selam@Gmail.com', reason: 'r' }).newEmail).toBe(
      'selam@gmail.com',
    )
    expect(memberEmailUpdateInputSchema.safeParse({ newEmail: 'not-an-email', reason: 'r' }).success).toBe(
      false,
    )
  })

  it('defaults the users list to all members, page 1 of 20, and turns a blank search into null', () => {
    expect(adminMemberQuerySchema.parse({ query: '  ' })).toEqual({
      filter: 'ALL',
      query: null,
      page: 1,
      pageSize: 20,
    })
    expect(adminMemberQuerySchema.safeParse({ filter: 'DELETED' }).success).toBe(false)
    expect(adminMemberQuerySchema.safeParse({ pageSize: '51' }).success).toBe(false)
  })
})
