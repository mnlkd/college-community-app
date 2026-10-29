import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError } from '../../src/kernel/index.js'
import { resetDatabase } from '../helpers/database.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(() => resetDatabase(t.container.prisma))

describe('PrismaTransactionRunner', () => {
  it('writes nothing when the work throws', async () => {
    const error = await t.container.transactions
      .run(async (tx) => {
        await tx.staffEmailEntry.create({ data: { email: 'first@hilcoeschool.com' } })
        await tx.$executeRaw`INSERT INTO staff_email_entry (email, updated_at) VALUES ('second@hilcoeschool.com', now())`
        throw new ConflictError()
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictError)
    expect(await t.container.prisma.staffEmailEntry.count()).toBe(0)
  })

  it('commits when the work returns and passes its result through', async () => {
    const result = await t.container.transactions.run(async (tx) => {
      await tx.staffEmailEntry.create({ data: { email: 'kept@hilcoeschool.com' } })
      return 'done'
    })
    expect(result).toBe('done')
    expect(await t.container.prisma.staffEmailEntry.count()).toBe(1)
  })
})

describe('database constraints written by hand', () => {
  it('rejects an upper-case member email and a role/alumni status mismatch', async () => {
    const prisma = t.container.prisma
    await expect(
      prisma.memberAccount.create({
        data: { email: 'Upper@hilcoeschool.com', displayName: 'X', role: 'STUDENT' },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.memberAccount.create({ data: { email: 'a@example.com', displayName: 'X', role: 'ALUMNI' } }),
    ).rejects.toThrow()
    await expect(
      prisma.memberAccount.create({
        data: { email: 'b@hilcoeschool.com', displayName: 'X', role: 'STUDENT', alumniStatus: 'VERIFIED' },
      }),
    ).rejects.toThrow()
  })

  it('allows only one first Administrator', async () => {
    const prisma = t.container.prisma
    await prisma.administratorAccount.create({
      data: { authUserId: crypto.randomUUID(), email: 'one@hilcoeschool.com', isFirstAdmin: true },
    })
    await expect(
      prisma.administratorAccount.create({
        data: { authUserId: crypto.randomUUID(), email: 'two@hilcoeschool.com', isFirstAdmin: true },
      }),
    ).rejects.toThrow()
  })

  it('fills the generated search vector of a post', async () => {
    const prisma = t.container.prisma
    const member = await prisma.memberAccount.create({
      data: { email: 'c@hilcoeschool.com', displayName: 'X', role: 'STUDENT' },
    })
    await prisma.post.create({ data: { authorId: member.id, body: 'Internship at a payments startup' } })
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM post WHERE search_vector @@ plainto_tsquery('simple', 'payments')`
    expect(Number(rows[0]?.n)).toBe(1)
  })
})
