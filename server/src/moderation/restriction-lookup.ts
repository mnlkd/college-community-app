import type { RestrictionReader, Tx } from '../kernel/index.js'

/** Reads the current restriction from the consequence table (ODD Table 21). */
export class RestrictionLookup implements RestrictionReader {
  async restrictedUntil(tx: Tx, memberId: string, now: Date): Promise<Date | null> {
    const result = await tx.consequence.aggregate({
      where: { memberId, kind: 'RESTRICTION', restrictUntil: { gt: now } },
      _max: { restrictUntil: true },
    })
    return result._max.restrictUntil
  }
}
