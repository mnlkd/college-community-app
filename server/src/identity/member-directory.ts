import type { PrismaClient } from '../generated/prisma/client.js'
import type { Tx } from '../kernel/index.js'
import type { MemberDirectory } from '../notifications/index.js'

/** identity's implementation of the notifications MemberDirectory port. */
export class IdentityMemberDirectory implements MemberDirectory {
  constructor(private readonly db: PrismaClient) {}

  async isLive(tx: Tx, memberId: string): Promise<boolean> {
    const member = await tx.memberAccount.findUnique({ where: { id: memberId }, select: { state: true } })
    return member !== null && member.state !== 'DELETED'
  }

  async displayNames(memberIds: readonly string[]): Promise<Map<string, string>> {
    if (memberIds.length === 0) return new Map()
    const rows = await this.db.memberAccount.findMany({
      where: { id: { in: [...memberIds] }, state: { not: 'DELETED' } },
      select: { id: true, displayName: true },
    })
    return new Map(rows.flatMap((row) => (row.displayName ? [[row.id, row.displayName] as const] : [])))
  }
}
