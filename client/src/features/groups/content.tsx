import type {
  ActorContextView,
  GroupApproveBlock,
  GroupJoinBlock,
  GroupMemberView,
  GroupRelation,
  GroupSummaryView,
} from '@hilcoe/shared'
import { Clock, UserCheck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Card, CapacityMeter, cx } from '../../design/ui'
import { ACTIVITIES_PATH, SaveToggle } from '../boards/content'
import { MemberLine } from '../posts/content'
import { canPublish } from '../posts/eligibility'

export const NEW_GROUP_PATH = `${ACTIVITIES_PATH}/new`
export const groupPath = (id: string) => `${ACTIVITIES_PATH}/groups/${id}`
export const manageGroupPath = (id: string) => `${groupPath(id)}/manage`

/** Only Students without a restriction create groups (FR-7); the server checks again. */
export function canCreateGroup(actor: ActorContextView): boolean {
  return actor.role === 'STUDENT' && canPublish(actor)
}

export const JOIN_BLOCK_TEXT: Record<GroupJoinBlock, string> = {
  NOT_STUDENT: 'Only Students can join groups.',
  CANNOT_INTERACT: 'Your account cannot join groups right now.',
  CLOSED: 'This group is closed and takes no new members.',
  FULL: 'This group is full. New requests open again when a place is free.',
}

export const APPROVE_BLOCK_TEXT: Record<GroupApproveBlock, string> = {
  FULL: 'The group is full. Raise the maximum or decline.',
  REQUESTER_INELIGIBLE: 'This member can no longer join groups.',
  CLOSED: 'The group is closed.',
}

const RELATIONS: Record<GroupRelation, { label: string; icon: typeof UserCheck }> = {
  OWNER: { label: 'You own this group', icon: UserCheck },
  MEMBER: { label: 'You are a member', icon: UserCheck },
  PENDING: { label: 'Request pending', icon: Clock },
}

export function isFull(group: Pick<GroupSummaryView, 'occupancy' | 'maxOccupancy'>): boolean {
  return group.occupancy >= group.maxOccupancy
}

export function GroupStateBadge({ group }: { group: GroupSummaryView }) {
  if (group.state === 'CLOSED') return <Badge>Closed</Badge>
  if (isFull(group)) return <Badge tone="amber">Full</Badge>
  return <Badge tone="green">Open</Badge>
}

/** A group on the Activities Board, in search, saved items or "My groups". */
export function GroupCard({ group, actor }: { group: GroupSummaryView; actor: ActorContextView }) {
  const closed = group.state === 'CLOSED'
  const free = Math.max(0, group.maxOccupancy - group.occupancy)
  const relation = group.viewerRelation ? RELATIONS[group.viewerRelation] : null
  return (
    <Card hover className="px-5 py-4">
      <article aria-label={group.title} className="flex items-start gap-3">
        <span
          className={cx(
            'flex size-12 shrink-0 items-center justify-center rounded-2xl text-white',
            closed ? 'bg-slate-9' : 'bg-green-9',
          )}
        >
          <Users className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Link
              to={groupPath(group.id)}
              className="font-display text-[15.5px] font-bold break-words text-slate-12 hover:underline"
            >
              {group.title}
            </Link>
            <div className="flex shrink-0 gap-1.5">
              {group.pendingCount !== null && group.pendingCount > 0 && (
                <Badge tone="iris">{group.pendingCount} pending</Badge>
              )}
              <GroupStateBadge group={group} />
            </div>
          </div>
          <p className="mt-0.5 text-[12.5px] text-slate-10">Owned by {group.owner.displayName}</p>
          <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed break-words text-slate-10">
            {group.description}
          </p>
          <div className="mt-3.5 flex items-end justify-between gap-3 border-t border-slate-4 pt-3">
            <div className="max-w-[220px] min-w-0 flex-1">
              <CapacityMeter filled={group.occupancy} total={group.maxOccupancy} />
              <p className="mt-1.5 text-[12px] text-slate-10">
                {closed
                  ? 'Closed to new members'
                  : free === 0
                    ? 'Full'
                    : `${free} ${free === 1 ? 'place' : 'places'} available`}{' '}
                · owner included
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {relation && (
                <span className="flex items-center gap-1 text-[12px] font-medium text-slate-10">
                  <relation.icon className="size-3.5" aria-hidden="true" />
                  {relation.label}
                </span>
              )}
              <SaveToggle
                actor={actor}
                type="GROUP"
                id={group.id}
                saved={group.savedByMe}
                open={!closed}
                noun="group"
              />
            </div>
          </div>
        </div>
      </article>
    </Card>
  )
}

/** The owner and accepted members, the owner first. */
export function MemberList({ members }: { members: GroupMemberView[] }) {
  const sorted = [...members].sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
  return (
    <ul className="mt-3 space-y-3">
      {sorted.map((member) => (
        <li key={member.membershipId} className="flex items-center justify-between gap-3">
          <MemberLine member={member.member} size={36} />
          {member.isOwner && <Badge tone="iris">Owner</Badge>}
        </li>
      ))}
    </ul>
  )
}
