import type { PostStat } from '../publishing/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** FR-20 trending score (ODD Table 11). */
export class TrendingRanker {
  /** (3L + 4C + 0.1V) / (1 + A), with A the age in days (fractional). */
  score(likes: number, commenters: number, views: number, ageDays: number): number {
    return (3 * likes + 4 * commenters + 0.1 * views) / (1 + Math.max(0, ageDays))
  }

  /** The post ids of the highest scores; on equal scores the newer post comes first. */
  rank(stats: readonly PostStat[], now: Date, limit: number): string[] {
    return stats
      .map((stat) => ({
        stat,
        score: this.score(
          stat.likes,
          stat.commenters,
          stat.views,
          (now.getTime() - stat.createdAt.getTime()) / DAY_MS,
        ),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.stat.createdAt.getTime() - a.stat.createdAt.getTime() ||
          (a.stat.postId < b.stat.postId ? 1 : -1),
      )
      .slice(0, limit)
      .map((entry) => entry.stat.postId)
  }
}
