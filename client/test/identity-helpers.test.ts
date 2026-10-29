import { describe, expect, it, vi } from 'vitest'
import { newPasswordIssues, parseCode } from '../src/auth/fields'
import { maskEmail } from '../src/auth/VerifyEmail'
import { noticeText, timeAgo } from '../src/features/notifications/Notifications'
import { pictureProblem } from '../src/features/profile/EditProfile'
import { roleDetailsInput, yearOptions } from '../src/features/profile/RoleDetailsFields'
import { registrationKindFor, roleFor } from '../src/features/registration/CompleteProfile'

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => {
    throw new Error('Supabase is not used in these tests')
  },
}))

const LONG = 'correct horse battery staple'

describe('newPasswordIssues', () => {
  it('accepts a long password that matches its confirmation', () => {
    expect(newPasswordIssues(LONG, LONG)).toEqual({})
  })

  it('reports a short password before a mismatch', () => {
    expect(Object.keys(newPasswordIssues('short', 'other'))).toEqual(['password'])
  })

  it('reports a mismatch under the given field name', () => {
    expect(newPasswordIssues(LONG, LONG + '!', { password: 'newPassword', confirm: 'again' })).toEqual({
      again: 'The passwords do not match',
    })
  })
})

describe('parseCode', () => {
  it('accepts six digits', () => {
    expect(parseCode('123456')).toEqual({ code: '123456', error: null })
  })

  it.each(['12345', '1234567', 'abcdef', ''])('rejects %j', (value) => {
    const result = parseCode(value)
    expect(result.code).toBeNull()
    expect(result.error).toBeTruthy()
  })
})

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('selamawit.girma@hilcoeschool.com')).toBe('s…@hilcoeschool.com')
  })
})

describe('registration role', () => {
  const status = { registered: false, email: 'a@hilcoeschool.com', institutional: true, staffListed: false }

  it('forces the Alumni path for a personal email', () => {
    expect(registrationKindFor({ ...status, institutional: false }, 'STUDENT_OR_STAFF')).toBe('ALUMNI')
  })

  it('keeps the chosen path for an institutional email, defaulting to Student or Staff', () => {
    expect(registrationKindFor(status, 'ALUMNI')).toBe('ALUMNI')
    expect(registrationKindFor(status, undefined)).toBe('STUDENT_OR_STAFF')
  })

  it('assigns Staff only from the staff list', () => {
    expect(roleFor(status, 'STUDENT_OR_STAFF')).toBe('STUDENT')
    expect(roleFor({ ...status, staffListed: true }, 'STUDENT_OR_STAFF')).toBe('STAFF')
    expect(roleFor({ ...status, staffListed: true }, 'ALUMNI')).toBe('ALUMNI')
  })
})

describe('yearOptions', () => {
  it('offers Students the current year to seven years ahead', () => {
    expect(yearOptions('STUDENT', 2026)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033])
  })

  it('offers Alumni the current year back to 1997', () => {
    const years = yearOptions('ALUMNI', 2026)
    expect(years[0]).toBe(2026)
    expect(years.at(-1)).toBe(1997)
    expect(years).toHaveLength(30)
  })
})

describe('roleDetailsInput', () => {
  const values = {
    programme: 'SOFTWARE_ENGINEERING',
    graduationYear: '2027',
    studyOrExpertise: 'Networks',
    currentPosition: 'Lecturer',
  }

  it('sends no programme or year for Staff', () => {
    expect(roleDetailsInput('STAFF', values)).toMatchObject({ programme: null, graduationYear: null })
  })

  it('sends the year as a number for Students', () => {
    expect(roleDetailsInput('STUDENT', values)).toMatchObject({
      programme: 'SOFTWARE_ENGINEERING',
      graduationYear: 2027,
    })
  })
})

describe('pictureProblem', () => {
  it('accepts JPEG, PNG and WebP up to 5 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(pictureProblem({ type, size: 5 * 1024 * 1024 })).toBeNull()
    }
  })

  it('rejects other types and larger files', () => {
    expect(pictureProblem({ type: 'image/gif', size: 10 })).toMatch(/JPEG, PNG or WebP/)
    expect(pictureProblem({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/)
  })
})

describe('noticeText', () => {
  const base = {
    id: 'n1',
    actorId: 'a1',
    actorName: 'Meron Tadesse',
    targetType: 'POST' as const,
    targetId: 't1',
    unread: true,
    createdAt: '2026-10-01T10:00:00.000Z',
  }

  it('starts member-caused notices with the actor name', () => {
    expect(noticeText({ ...base, type: 'COMMENT' })).toEqual({
      actor: 'Meron Tadesse',
      text: 'commented on your post.',
    })
    expect(noticeText({ ...base, type: 'LIKE', targetType: 'COMMENT' }).text).toBe('liked your comment.')
  })

  it('shows Deleted User as given by the server', () => {
    expect(noticeText({ ...base, type: 'REPLY', actorName: 'Deleted User' }).actor).toBe('Deleted User')
  })

  it('names no member for decisions', () => {
    expect(noticeText({ ...base, type: 'ALUMNI_DECISION', actorId: null, actorName: null }).actor).toBeNull()
  })
})

describe('timeAgo', () => {
  it('uses the largest whole unit', () => {
    const now = Date.parse('2026-10-01T12:00:00.000Z')
    expect(timeAgo('2026-10-01T11:58:00.000Z', now)).toMatch(/2 minutes ago/)
    expect(timeAgo('2026-09-29T12:00:00.000Z', now)).toMatch(/2 days ago/)
  })
})
