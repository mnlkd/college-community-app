import { z } from 'zod'
import { accountStateSchema, actorKindSchema, alumniStatusSchema, roleSchema } from './enums.js'

/** Read-only view of the caller's ActorContext (ODD Table 5), returned by the "me" endpoints. */
export const actorContextViewSchema = z.object({
  accountId: z.uuid(),
  kind: actorKindSchema,
  role: roleSchema.nullable(),
  alumniStatus: alumniStatusSchema.nullable(),
  accountState: accountStateSchema,
  restrictedUntil: z.iso.datetime().nullable(),
  mfaVerified: z.boolean(),
  isFirstAdmin: z.boolean(),
})

export type ActorContextView = z.infer<typeof actorContextViewSchema>
