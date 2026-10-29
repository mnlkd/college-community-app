import { describe, expect, it } from 'vitest'
import {
  graduationInputSchema,
  isInstitutionalEmail,
  notificationInputSchema,
  profileInputSchema,
  registrationInputSchema,
  roleDetailsIssues,
  roleDetailsSchema,
} from '@hilcoe/shared'

const YEAR = 2026
const details = (value: Record<string, unknown>) => roleDetailsSchema.parse(value)

describe('role details', () => {
  it('requires a programme and an expected year from now to seven years ahead for Students', () => {
    expect(
      roleDetailsIssues('STUDENT', details({ programme: 'COMPUTER_SCIENCE', graduationYear: 2033 }), YEAR),
    ).toEqual({})
    expect(
      roleDetailsIssues('STUDENT', details({ programme: 'COMPUTER_SCIENCE', graduationYear: 2025 }), YEAR),
    ).toHaveProperty('graduationYear')
    expect(
      roleDetailsIssues('STUDENT', details({ programme: 'COMPUTER_SCIENCE', graduationYear: 2034 }), YEAR),
    ).toHaveProperty('graduationYear')
    expect(roleDetailsIssues('STUDENT', details({}), YEAR)).toEqual({
      programme: 'Required',
      graduationYear: 'Required',
    })
  })

  it('requires a past graduation year from 1997 for Alumni', () => {
    expect(
      roleDetailsIssues('ALUMNI', details({ programme: 'SOFTWARE_ENGINEERING', graduationYear: 1997 }), YEAR),
    ).toEqual({})
    expect(
      roleDetailsIssues('ALUMNI', details({ programme: 'SOFTWARE_ENGINEERING', graduationYear: 1996 }), YEAR),
    ).toHaveProperty('graduationYear')
    expect(
      roleDetailsIssues('ALUMNI', details({ programme: 'SOFTWARE_ENGINEERING', graduationYear: 2027 }), YEAR),
    ).toHaveProperty('graduationYear')
  })

  it('requires expertise and position for Staff and refuses a programme or year', () => {
    expect(
      roleDetailsIssues(
        'STAFF',
        details({ studyOrExpertise: 'SE Department', currentPosition: 'Lecturer' }),
        YEAR,
      ),
    ).toEqual({})
    expect(roleDetailsIssues('STAFF', details({ studyOrExpertise: '  ' }), YEAR)).toEqual({
      studyOrExpertise: 'Required',
      currentPosition: 'Required',
    })
    expect(
      roleDetailsIssues(
        'STAFF',
        details({
          studyOrExpertise: 'x',
          currentPosition: 'y',
          programme: 'COMPUTER_SCIENCE',
          graduationYear: 2020,
        }),
        YEAR,
      ),
    ).toEqual({ programme: expect.any(String), graduationYear: expect.any(String) })
  })
})

describe('registration input', () => {
  it('trims the display name and rejects blank or over-long names', () => {
    const parsed = registrationInputSchema.parse({ kind: 'STUDENT_OR_STAFF', displayName: '  Selam  ' })
    expect(parsed.displayName).toBe('Selam')
    expect(registrationInputSchema.safeParse({ kind: 'STUDENT_OR_STAFF', displayName: '  ' }).success).toBe(
      false,
    )
    expect(registrationInputSchema.safeParse({ kind: 'ALUMNI', displayName: 'x'.repeat(101) }).success).toBe(
      false,
    )
  })

  it('keeps optional Alumni context as null when blank and rejects it over 1,000 characters', () => {
    expect(
      registrationInputSchema.parse({ kind: 'ALUMNI', displayName: 'Hanan', identifyingContext: ' ' }),
    ).toMatchObject({
      identifyingContext: null,
    })
    expect(
      registrationInputSchema.safeParse({
        kind: 'ALUMNI',
        displayName: 'H',
        identifyingContext: 'x'.repeat(1001),
      }).success,
    ).toBe(false)
  })
})

describe('profile input', () => {
  it('accepts a 500-character bio and refuses 501', () => {
    expect(profileInputSchema.safeParse({ displayName: 'A', bio: 'x'.repeat(500) }).success).toBe(true)
    expect(profileInputSchema.safeParse({ displayName: 'A', bio: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('graduation input and helpers', () => {
  it('needs a programme and an integer year', () => {
    expect(
      graduationInputSchema.safeParse({ programme: 'COMPUTER_SCIENCE', graduationYear: 2026 }).success,
    ).toBe(true)
    expect(graduationInputSchema.safeParse({ programme: 'ART', graduationYear: 2026 }).success).toBe(false)
    expect(
      graduationInputSchema.safeParse({ programme: 'COMPUTER_SCIENCE', graduationYear: 2026.5 }).success,
    ).toBe(false)
  })

  it('recognizes institutional email in any letter case', () => {
    expect(isInstitutionalEmail('A@HiLCoESchool.com')).toBe(true)
    expect(isInstitutionalEmail('a@gmail.com')).toBe(false)
  })

  it('validates notification input', () => {
    const id = '0192f0c4-7d1a-7c1e-8f3a-1b2c3d4e5f60'
    const input = {
      recipientId: id,
      type: 'LIKE',
      eventKey: 'like:1',
      actorId: null,
      targetType: 'POST',
      targetId: id,
    }
    expect(notificationInputSchema.safeParse(input).success).toBe(true)
    expect(notificationInputSchema.safeParse({ ...input, eventKey: ' ' }).success).toBe(false)
    expect(notificationInputSchema.safeParse({ ...input, targetType: 'NOPE' }).success).toBe(false)
  })
})
