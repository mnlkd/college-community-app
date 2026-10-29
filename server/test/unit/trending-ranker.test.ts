import { describe, expect, it } from 'vitest'
import { TrendingRanker } from '../../src/boards/index.js'

const DAY = 86_400_000
const now = new Date('2026-10-08T12:00:00Z')
const ranker = new TrendingRanker()

describe('TrendingRanker', () => {
  it('scores (3L + 4C + 0.1V) / (1 + A)', () => {
    expect(ranker.score(2, 1, 10, 0)).toBeCloseTo(11)
    expect(ranker.score(2, 1, 10, 1)).toBeCloseTo(5.5)
    expect(ranker.score(0, 0, 0, 3)).toBe(0)
    expect(ranker.score(1, 0, 0, 0.5)).toBeCloseTo(2)
  })

  it('ranks by score, ties going to the newer post, and honours the limit', () => {
    const stat = (postId: string, likes: number, ageDays: number) => ({
      postId,
      likes,
      commenters: 0,
      views: 0,
      createdAt: new Date(now.getTime() - ageDays * DAY),
    })
    const stats = [stat('old', 4, 1), stat('new', 2, 0), stat('top', 9, 0), stat('none', 0, 0)]
    // old: 12 / 2 = 6, new: 6 / 1 = 6 (tie, newer first), top: 27.
    expect(ranker.rank(stats, now, 3)).toEqual(['top', 'new', 'old'])
    expect(ranker.rank(stats, now, 10)).toEqual(['top', 'new', 'old', 'none'])
  })
})
