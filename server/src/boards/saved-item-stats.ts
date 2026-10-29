import type { SaveTargetType } from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { GroupSaveStats } from '../groups/index.js'
import type { OpportunitySaveStats } from '../opportunities/index.js'
import type { PostSaveStats } from '../publishing/index.js'

type SaveFacts = Map<string, { count: number; savedByMe: boolean }>

/**
 * Gives publishing, opportunities and groups the aggregate save counts of their items and the
 * viewer's own saves (FR-16), without those packages reading the boards tables.
 */
export class SavedItemStats implements PostSaveStats, OpportunitySaveStats, GroupSaveStats {
  constructor(private readonly db: PrismaClient) {}

  postSaves(memberId: string, postIds: readonly string[]): Promise<SaveFacts> {
    return this.saves('POST', memberId, postIds)
  }

  opportunitySaves(memberId: string, opportunityIds: readonly string[]): Promise<SaveFacts> {
    return this.saves('OPPORTUNITY', memberId, opportunityIds)
  }

  groupSaves(memberId: string, groupIds: readonly string[]): Promise<SaveFacts> {
    return this.saves('GROUP', memberId, groupIds)
  }

  private async saves(
    targetType: SaveTargetType,
    memberId: string,
    targetIds: readonly string[],
  ): Promise<SaveFacts> {
    const ids = [...targetIds]
    if (ids.length === 0) return new Map()
    const [counts, mine] = await Promise.all([
      this.db.savedItem.groupBy({
        by: ['targetId'],
        where: { targetType, targetId: { in: ids } },
        _count: { _all: true },
      }),
      this.db.savedItem.findMany({
        where: { memberId, targetType, targetId: { in: ids } },
        select: { targetId: true },
      }),
    ])
    const savedIds = new Set(mine.map((row) => row.targetId))
    return new Map(
      counts.map((row) => [row.targetId, { count: row._count._all, savedByMe: savedIds.has(row.targetId) }]),
    )
  }
}
