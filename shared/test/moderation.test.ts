import { describe, expect, it } from 'vitest'
import {
  adminReportQuerySchema,
  auditRecordQuerySchema,
  reportDecisionInputSchema,
  reportInputSchema,
} from '@hilcoe/shared'

const targetId = '0190a5f2-8c1e-7d3a-9f4b-2c6e8a1b3d5f'

describe('Moderation inputs', () => {
  it('requires a target, a guideline category and at most 1000 characters of details', () => {
    expect(reportInputSchema.parse({ targetType: 'POST', targetId, reason: 'SPAM', details: '  ' })).toEqual({
      targetType: 'POST',
      targetId,
      reason: 'SPAM',
      details: null,
    })
    expect(
      reportInputSchema.parse({ targetType: 'COMMENT', targetId, reason: 'HARASSMENT', details: ' rude ' })
        .details,
    ).toBe('rude')
    expect(reportInputSchema.safeParse({ targetType: 'POST', targetId, reason: 'OTHER' }).success).toBe(false)
    expect(reportInputSchema.safeParse({ targetType: 'GROUP', targetId, reason: 'SPAM' }).success).toBe(false)
    expect(
      reportInputSchema.safeParse({ targetType: 'POST', targetId, reason: 'SPAM', details: 'x'.repeat(1001) })
        .success,
    ).toBe(false)
    expect(reportInputSchema.safeParse({ targetType: 'POST', targetId: 'abc', reason: 'SPAM' }).success).toBe(
      false,
    )
  })

  it('accepts only a final decision with a non-blank private reason', () => {
    expect(reportDecisionInputSchema.parse({ decision: 'UPHELD', reason: ' clear spam ' })).toEqual({
      decision: 'UPHELD',
      reason: 'clear spam',
    })
    expect(reportDecisionInputSchema.safeParse({ decision: 'PENDING', reason: 'r' }).success).toBe(false)
    expect(reportDecisionInputSchema.safeParse({ decision: 'DISMISSED', reason: '  ' }).success).toBe(false)
    expect(
      reportDecisionInputSchema.safeParse({ decision: 'DISMISSED', reason: 'x'.repeat(1001) }).success,
    ).toBe(false)
  })

  it('lists pending reports by default', () => {
    expect(adminReportQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, state: 'PENDING' })
    expect(adminReportQuerySchema.parse({ state: 'ALL', page: '2' }).page).toBe(2)
    expect(adminReportQuerySchema.safeParse({ state: 'OPEN' }).success).toBe(false)
  })

  it('treats blank audit filters as absent and refuses an inverted date range', () => {
    expect(auditRecordQuerySchema.parse({ action: '', adminId: '', from: '' })).toEqual({
      page: 1,
      pageSize: 20,
      action: null,
      adminId: null,
      memberId: null,
      from: null,
      to: null,
    })
    expect(
      auditRecordQuerySchema.parse({ action: 'REPORT_DECIDED', from: '2026-10-01', to: '2026-10-01' }),
    ).toMatchObject({ action: 'REPORT_DECIDED', from: '2026-10-01', to: '2026-10-01' })
    expect(auditRecordQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(false)
    expect(auditRecordQuerySchema.safeParse({ from: '01/10/2026' }).success).toBe(false)
    expect(auditRecordQuerySchema.safeParse({ adminId: 'not-a-uuid' }).success).toBe(false)
  })
})
