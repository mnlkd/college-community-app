import { describe, expect, it } from 'vitest'
import { analyticsQuerySchema } from '@hilcoe/shared'

describe('Analytics query', () => {
  it('accepts a 7-day or 30-day window and defaults to 30', () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ windowDays: 30 })
    expect(analyticsQuerySchema.parse({ windowDays: '7' })).toEqual({ windowDays: 7 })
    expect(analyticsQuerySchema.parse({ windowDays: 30 })).toEqual({ windowDays: 30 })
  })

  it('refuses any other window', () => {
    for (const windowDays of ['1', '14', '31', 'abc', '7.5', '-7']) {
      expect(analyticsQuerySchema.safeParse({ windowDays }).success).toBe(false)
    }
  })
})
