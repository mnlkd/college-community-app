import type { AuditWriter, Clock, FileStorage, Tx, WarningLogger } from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import type { AuthProvider } from './auth-provider.js'
import type { AccountLifecyclePublisher } from './lifecycle.js'

export interface AccountDeletionDeps {
  clock: Clock
  authProvider: AuthProvider
  notifications: NotificationService
  lifecycle: AccountLifecyclePublisher
  audit: AuditWriter
}

/**
 * The deletion steps shared by deleteOwnAccount and deleteFakeAccount, run in the caller's
 * transaction on the locked account row: publishes ACCOUNT_DELETED, removes personal data and the
 * member's notices, keeps the row as DELETED (content shows Deleted User), anonymizes audit
 * records and deletes the Supabase user last, so a failure there rolls the whole change back.
 * Returns the storage keys to remove once the transaction has committed.
 */
export async function deleteMemberAccount(
  tx: Tx,
  deps: AccountDeletionDeps,
  account: { id: string; authUserId: string | null },
): Promise<string[]> {
  const memberId = account.id
  await deps.lifecycle.publish(tx, {
    kind: 'ACCOUNT_DELETED',
    memberId,
    newRole: null,
    occurredAt: deps.clock.now(),
  })
  const images = await tx.profileImage.findMany({ where: { memberId }, select: { storageKey: true } })
  await tx.profile.deleteMany({ where: { memberId } })
  await tx.profileImage.deleteMany({ where: { memberId } })
  await tx.graduationRequest.deleteMany({ where: { memberId } })
  await tx.alumniReview.deleteMany({ where: { memberId } })
  await deps.notifications.removeForRecipient(tx, memberId)
  await tx.memberAccount.update({
    where: { id: memberId },
    data: { authUserId: null, email: null, displayName: null, programme: null, state: 'DELETED' },
  })
  await deps.audit.anonymize(tx, memberId)
  if (account.authUserId) await deps.authProvider.deleteUser(account.authUserId)
  return images.map((image) => image.storageKey)
}

/** Best effort after the commit; an orphaned private file is harmless and is logged. */
export async function removeStoredFiles(
  storage: FileStorage,
  logger: WarningLogger,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.remove(key)
    } catch (error) {
      logger.warn({ err: error, storageKey: key }, 'could not remove a stored file')
    }
  }
}
