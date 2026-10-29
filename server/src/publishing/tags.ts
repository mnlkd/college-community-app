import type { Tx } from '../kernel/index.js'

/** Replaces the tags of a post with the given normalized labels, creating new labels as needed. */
export async function setPostTags(tx: Tx, postId: string, labels: readonly string[]): Promise<void> {
  await tx.postTag.deleteMany({ where: { postId } })
  if (labels.length === 0) return
  await tx.tag.createMany({
    data: labels.map((normalizedLabel) => ({ normalizedLabel })),
    skipDuplicates: true,
  })
  const tags = await tx.tag.findMany({
    where: { normalizedLabel: { in: [...labels] } },
    select: { id: true },
  })
  await tx.postTag.createMany({ data: tags.map((tag) => ({ postId, tagId: tag.id })) })
}
