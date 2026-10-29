import { describe, expect, it } from 'vitest'
import {
  emailSchema,
  institutionalEmailSchema,
  isErrorBody,
  optionalText,
  pageRequestSchema,
  passwordSchema,
  requiredText,
  sixDigitCodeSchema,
} from '@hilcoe/shared'

describe('text rules', () => {
  it('trims required text and rejects blank values', () => {
    expect(requiredText(10).parse('  hello ')).toBe('hello')
    expect(requiredText(10).safeParse('   ').success).toBe(false)
  })

  it('rejects text over the limit instead of truncating', () => {
    expect(requiredText(5).safeParse('abcdef').success).toBe(false)
    expect(optionalText(5).safeParse('abcdef').success).toBe(false)
  })

  it('turns blank or missing optional text into null', () => {
    expect(optionalText(10).parse('   ')).toBeNull()
    expect(optionalText(10).parse(undefined)).toBeNull()
    expect(optionalText(10).parse(null)).toBeNull()
    expect(optionalText(10).parse(' x ')).toBe('x')
  })

  it('lower-cases and trims emails', () => {
    expect(emailSchema.parse('  Selam.Girma@HiLCoESchool.com ')).toBe('selam.girma@hilcoeschool.com')
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@x.co`).success).toBe(false)
  })

  it('accepts only the institutional domain for institutional emails', () => {
    expect(institutionalEmailSchema.safeParse('a@HILCOESCHOOL.COM').success).toBe(true)
    expect(institutionalEmailSchema.safeParse('a@gmail.com').success).toBe(false)
  })

  it('accepts passwords of 15 to 72 characters without composition rules', () => {
    expect(passwordSchema.safeParse('a'.repeat(14)).success).toBe(false)
    expect(passwordSchema.safeParse('a'.repeat(15)).success).toBe(true)
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false)
  })

  it('normalizes six-digit codes', () => {
    expect(sixDigitCodeSchema.parse('123 456')).toBe('123456')
    expect(sixDigitCodeSchema.safeParse('12345').success).toBe(false)
  })
})

describe('pagination', () => {
  it('defaults to page 1 with 20 items', () => {
    expect(pageRequestSchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })

  it('accepts 1 to 50 items per page and pages from 1', () => {
    expect(pageRequestSchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 })
    expect(pageRequestSchema.safeParse({ pageSize: 51 }).success).toBe(false)
    expect(pageRequestSchema.safeParse({ pageSize: 0 }).success).toBe(false)
    expect(pageRequestSchema.safeParse({ page: 0 }).success).toBe(false)
  })
})

describe('error body', () => {
  it('recognizes the error body shape', () => {
    expect(isErrorBody({ error: { code: 'NOT_FOUND', message: 'x', fields: null } })).toBe(true)
    expect(isErrorBody({ error: { code: 'NOPE', message: 'x' } })).toBe(false)
    expect(isErrorBody('x')).toBe(false)
  })
})
