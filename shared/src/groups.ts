import { z } from 'zod'
import { groupStateSchema, type GroupState, type MembershipState, type TransferState } from './enums.js'
import type { MemberCardView } from './identity.js'
import { pageRequestSchema } from './pagination.js'
import { tagSchema } from './publishing.js'
import { optionalText, requiredText, uuidSchema } from './text.js'

// groups Input/View types (ODD Section 3.7, Tables 17 and 18).

export const GROUP_TITLE_MAX = 160
export const GROUP_DESCRIPTION_MAX = 5000
export const GROUP_COORDINATION_MAX = 5000
/** maxOccupancy is a positive whole number including the owner; the upper bound is an implementation choice. */
export const GROUP_OCCUPANCY_MAX = 100

/** GroupInput of Table 18 (create). */
export const groupInputSchema = z.object({
  title: requiredText(GROUP_TITLE_MAX),
  description: requiredText(GROUP_DESCRIPTION_MAX),
  maxOccupancy: z
    .number({ error: 'Enter a whole number' })
    .int('Enter a whole number')
    .min(1, 'At least 1')
    .max(GROUP_OCCUPANCY_MAX, `At most ${GROUP_OCCUPANCY_MAX}`),
  /** A meeting place, schedule or chat link; shown only to accepted members. */
  coordinationDetails: optionalText(GROUP_COORDINATION_MAX),
})
export type GroupInput = z.input<typeof groupInputSchema>
export type ParsedGroupInput = z.output<typeof groupInputSchema>

/** editGroup: the input with the version the owner last read. */
export const groupEditInputSchema = groupInputSchema.extend({
  version: z.number().int().min(1),
})
export type GroupEditInput = z.input<typeof groupEditInputSchema>

/** The Activities Board: open groups by keyword or #tag (searched as a word). */
export const groupBoardQuerySchema = pageRequestSchema.extend({
  text: optionalText(200),
  tag: tagSchema.nullish().transform((value) => value ?? null),
})
export type GroupBoardQuery = z.input<typeof groupBoardQuerySchema>
export type ParsedGroupBoardQuery = z.output<typeof groupBoardQuerySchema>

/** The viewer's relation to a group. */
export const GROUP_RELATIONS = ['OWNER', 'MEMBER', 'PENDING'] as const
export const groupRelationSchema = z.enum(GROUP_RELATIONS)
export type GroupRelation = z.infer<typeof groupRelationSchema>

/** "My groups": groups the viewer owns, has joined or has asked to join. */
export const myGroupsQuerySchema = pageRequestSchema.extend({
  relation: groupRelationSchema.nullish().transform((value) => value ?? null),
  state: groupStateSchema.nullish().transform((value) => value ?? null),
})
export type MyGroupsQuery = z.input<typeof myGroupsQuerySchema>
export type ParsedMyGroupsQuery = z.output<typeof myGroupsQuerySchema>

/** proposeTransfer: the accepted member proposed as the new owner. */
export const groupTransferInputSchema = z.object({ memberId: uuidSchema })
export type GroupTransferInput = z.input<typeof groupTransferInputSchema>

/** listJoinRequests paging. */
export const joinRequestsQuerySchema = pageRequestSchema

/** Why the viewer cannot ask to join now; checked again by the server. */
export const GROUP_JOIN_BLOCKS = ['NOT_STUDENT', 'CANNOT_INTERACT', 'CLOSED', 'FULL'] as const
export type GroupJoinBlock = (typeof GROUP_JOIN_BLOCKS)[number]

/** Why the owner cannot approve this pending request now; checked again on approval. */
export const GROUP_APPROVE_BLOCKS = ['FULL', 'REQUESTER_INELIGIBLE', 'CLOSED'] as const
export type GroupApproveBlock = (typeof GROUP_APPROVE_BLOCKS)[number]

/** A group on the Activities Board, in search or in "My groups"; never with coordination details. */
export interface GroupSummaryView {
  id: string
  owner: MemberCardView
  title: string
  description: string
  maxOccupancy: number
  /** ACCEPTED memberships, the owner included; pending requests reserve no place. */
  occupancy: number
  state: GroupState
  version: number
  createdAt: string
  updatedAt: string
  /** Null when the viewer is neither owner, accepted member nor pending requester. */
  viewerRelation: GroupRelation | null
  /** Null when the viewer may ask to join now (or already belongs). */
  joinBlock: GroupJoinBlock | null
  /** The owner's count of pending requests; null for anyone else. */
  pendingCount: number | null
  savedByMe: boolean
}

export interface GroupMemberView {
  membershipId: string
  member: MemberCardView
  isOwner: boolean
  joinedAt: string | null
}

export interface GroupView extends GroupSummaryView {
  /** Only for accepted members; null otherwise and while the owner is disabled. */
  coordinationDetails: string | null
  /** True for an accepted member while details exist but are withheld (owner disabled). */
  coordinationWithheld: boolean
  /** Accepted members, shown only to accepted members; null for anyone else. */
  members: GroupMemberView[] | null
  /** The pending transfer, shown only to the owner and the proposed recipient. */
  pendingTransfer: GroupTransferView | null
}

/** A join request or membership. */
export interface MembershipView {
  id: string
  groupId: string
  member: MemberCardView
  state: MembershipState
  requestedAt: string
  joinedAt: string | null
  /** Set for the owner on a PENDING request that cannot be approved now. */
  approveBlock: GroupApproveBlock | null
}

export const TRANSFER_SIDES = ['OWNER', 'RECIPIENT'] as const
export type TransferSide = (typeof TRANSFER_SIDES)[number]

/** An ownership transfer, shown only to the proposing owner and the recipient. */
export interface GroupTransferView {
  id: string
  group: { id: string; title: string; state: GroupState; occupancy: number; maxOccupancy: number }
  fromOwner: MemberCardView
  toMember: MemberCardView
  state: TransferState
  createdAt: string
  decidedAt: string | null
  viewerSide: TransferSide
}
