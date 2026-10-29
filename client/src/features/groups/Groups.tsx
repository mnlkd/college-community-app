import {
  GROUP_COORDINATION_MAX,
  GROUP_DESCRIPTION_MAX,
  GROUP_OCCUPANCY_MAX,
  GROUP_RELATIONS,
  GROUP_TITLE_MAX,
  SEARCH_TEXT_MAX,
  groupInputSchema,
  normalizeTag,
  type ActorContextView,
  type GroupInput,
  type GroupRelation,
  type GroupView,
  type MembershipView,
} from '@hilcoe/shared'
import { Clock, Plus, Users, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  isApiError,
  useCreateGroup,
  useDecideJoinRequest,
  useEditGroup,
  useGroup,
  useGroupAction,
  useGroupBoard,
  useJoinRequests,
  useMyGroups,
  useProposeTransfer,
  useTransferAction,
  type GroupAction,
  type TransferAction,
} from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import {
  Badge,
  Button,
  Card,
  CapacityMeter,
  ColumnHeader,
  Field,
  Note,
  Select,
  TextArea,
  TextInput,
  buttonClass,
} from '../../design/ui'
import {
  ACTIVITIES_PATH,
  BackLink,
  BoardIntro,
  BoardSearch,
  BoardsHeader,
  SaveToggle,
  Segmented,
  pageOf,
} from '../boards/content'
import { timeAgo } from '../notifications/Notifications'
import { LinkedText, MemberLine, Pager } from '../posts/content'
import { fieldErrorsOf } from '../profile/RoleDetailsFields'
import {
  APPROVE_BLOCK_TEXT,
  GroupCard,
  GroupStateBadge,
  JOIN_BLOCK_TEXT,
  MemberList,
  NEW_GROUP_PATH,
  canCreateGroup,
  groupPath,
  isFull,
  manageGroupPath,
} from './content'

const RELATION_FILTERS: { value: 'ALL' | GroupRelation; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OWNER', label: 'Owned' },
  { value: 'MEMBER', label: 'Joined' },
  { value: 'PENDING', label: 'Requested' },
]

const isRelation = (value: string | null): value is GroupRelation =>
  (GROUP_RELATIONS as readonly string[]).includes(value ?? '')

/** The Activities Board: open groups by keyword or #tag, or the viewer's own groups. */
export function ActivitiesBoard() {
  const actor = useOutletContext<ActorContextView>()
  const [params, setParams] = useSearchParams()
  const mine = params.get('view') === 'mine'
  const relationParam = params.get('relation')
  const relation = isRelation(relationParam) ? relationParam : null
  const text = params.get('text') ?? ''
  const tag = normalizeTag(params.get('tag') ?? '') ?? ''
  const page = pageOf(params)
  const [typed, setTyped] = useState(text)

  function update(
    next: Partial<{ mine: boolean; relation: GroupRelation | null; text: string; tag: string; page: number }>,
  ) {
    const copy = new URLSearchParams()
    const nextMine = next.mine ?? mine
    if (nextMine) {
      copy.set('view', 'mine')
      const nextRelation = next.relation === undefined ? relation : next.relation
      if (nextRelation) copy.set('relation', nextRelation)
    } else {
      const nextText = (next.text ?? text).trim()
      const nextTag = next.tag ?? tag
      if (nextText) copy.set('text', nextText)
      if (nextTag) copy.set('tag', nextTag)
    }
    if ((next.page ?? 1) > 1) copy.set('page', String(next.page))
    setParams(copy)
  }

  function submit() {
    const value = typed.trim()
    const asTag = /^#\S+$/.test(value) ? normalizeTag(value) : null
    if (asTag) {
      setTyped('')
      update({ mine: false, text: '', tag: asTag })
    } else update({ mine: false, text: value })
  }

  return (
    <>
      <BoardsHeader
        active="ACTIVITIES"
        right={
          canCreateGroup(actor) && (
            <Link to={NEW_GROUP_PATH} className={buttonClass({ size: 'sm' })}>
              <Plus className="size-3.5" aria-hidden="true" /> New group
            </Link>
          )
        }
      />
      {!mine && (
        <BoardSearch
          label="Search groups"
          placeholder="Search activity keywords, or #tag"
          value={typed}
          maxLength={SEARCH_TEXT_MAX}
          onChange={setTyped}
          onSubmit={submit}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Show groups"
          value={mine ? 'mine' : 'open'}
          options={[
            { value: 'open', label: 'Open groups' },
            { value: 'mine', label: 'My groups' },
          ]}
          onChange={(value) => update({ mine: value === 'mine' })}
        />
        {mine && (
          <Segmented
            label="My relation"
            value={relation ?? 'ALL'}
            options={RELATION_FILTERS}
            onChange={(value) => update({ relation: value === 'ALL' ? null : value })}
          />
        )}
        {!mine && tag && (
          <Badge tone="iris">
            #{tag}
            <button type="button" aria-label={`Remove tag filter ${tag}`} onClick={() => update({ tag: '' })}>
              <X className="size-3" />
            </button>
          </Badge>
        )}
      </div>
      <BoardIntro>
        Students create groups and ask to join them. Every membership needs the owner&apos;s approval. Places
        include the owner; pending requests reserve none.
      </BoardIntro>
      {mine ? (
        <MyGroupsList
          actor={actor}
          relation={relation}
          page={page}
          onPage={(next) => update({ page: next })}
        />
      ) : (
        <OpenGroupsList
          actor={actor}
          text={text}
          tag={tag}
          page={page}
          onPage={(next) => update({ page: next })}
        />
      )}
    </>
  )
}

function OpenGroupsList({
  actor,
  text,
  tag,
  page,
  onPage,
}: {
  actor: ActorContextView
  text: string
  tag: string
  page: number
  onPage: (page: number) => void
}) {
  const board = useGroupBoard(actor.accountId, { text, tag }, page)
  if (board.isPending) return <LoadingContent label="Loading groups…" />
  if (board.isError)
    return <ErrorContent message={board.error.message} onRetry={() => void board.refetch()} />
  if (board.data.items.length === 0) {
    return (
      <Note>
        {page > 1
          ? 'No more groups.'
          : text || tag
            ? 'No open groups match your search.'
            : 'No open groups right now. Start one!'}
      </Note>
    )
  }
  return (
    <>
      <div className="space-y-3">
        {board.data.items.map((group) => (
          <GroupCard key={group.id} group={group} actor={actor} />
        ))}
      </div>
      <Pager
        page={page}
        total={board.data.total}
        pageSize={board.data.pageSize}
        onPage={onPage}
        previous="Previous"
        next="Next"
      />
    </>
  )
}

function MyGroupsList({
  actor,
  relation,
  page,
  onPage,
}: {
  actor: ActorContextView
  relation: GroupRelation | null
  page: number
  onPage: (page: number) => void
}) {
  const groups = useMyGroups(actor.accountId, { relation, state: null }, page)
  if (groups.isPending) return <LoadingContent label="Loading your groups…" />
  if (groups.isError)
    return <ErrorContent message={groups.error.message} onRetry={() => void groups.refetch()} />
  if (groups.data.items.length === 0) {
    return <Note>{page > 1 ? 'No more groups.' : 'You have no groups here yet.'}</Note>
  }
  return (
    <>
      <div className="space-y-3">
        {groups.data.items.map((group) => (
          <GroupCard key={group.id} group={group} actor={actor} />
        ))}
      </div>
      <Pager
        page={page}
        total={groups.data.total}
        pageSize={groups.data.pageSize}
        onPage={onPage}
        previous="Previous"
        next="Next"
      />
    </>
  )
}

function GroupUnavailable({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isApiError(error) && error.status === 404) {
    return (
      <>
        <BackLink to={ACTIVITIES_PATH}>Activities Board</BackLink>
        <ColumnHeader title="Group unavailable" />
        <Note>This group does not exist or is not available to you.</Note>
      </>
    )
  }
  return <ErrorContent message={error.message} onRetry={onRetry} />
}

const errorText = (cause: unknown, fallback: string) => (isApiError(cause) ? cause.message : fallback)

/** A group: its state, places and owner; members and coordination details only to members. */
export function GroupDetail() {
  const actor = useOutletContext<ActorContextView>()
  const { groupId = '' } = useParams()
  const location = useLocation()
  const group = useGroup(actor.accountId, groupId)
  const [status, setStatus] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  if (group.isPending) return <LoadingContent />
  if (group.isError) return <GroupUnavailable error={group.error} onRetry={() => void group.refetch()} />
  const view = group.data
  const member = view.viewerRelation === 'OWNER' || view.viewerRelation === 'MEMBER'
  const closed = view.state === 'CLOSED'
  const offer = view.pendingTransfer?.viewerSide === 'RECIPIENT' ? view.pendingTransfer : null
  return (
    <>
      <BackLink to={ACTIVITIES_PATH}>Activities Board</BackLink>
      <ColumnHeader
        title="Group"
        right={
          view.viewerRelation === 'OWNER' &&
          !closed && (
            <Link to={manageGroupPath(view.id)} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Manage group
            </Link>
          )
        }
      />
      {status && (
        <div className="mb-3" role="status">
          <Note tone="iris">{status}</Note>
        </div>
      )}
      {offer && (
        <TransferOffer
          actor={actor}
          transferId={offer.id}
          from={offer.fromOwner.displayName}
          onDone={setStatus}
        />
      )}
      <Card className="p-5">
        <div className="flex items-start gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-green-9 to-green-11 shadow-sm">
            <Users className="size-5 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[21px] leading-tight font-extrabold tracking-[-0.03em] break-words text-slate-12">
              {view.title}
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <GroupStateBadge group={view} />
              {view.viewerRelation === 'PENDING' && <Badge tone="amber">Request pending</Badge>}
              {view.viewerRelation === 'MEMBER' && <Badge tone="iris">Member</Badge>}
              {view.viewerRelation === 'OWNER' && <Badge tone="iris">Owner</Badge>}
            </div>
          </div>
          <SaveToggle
            actor={actor}
            type="GROUP"
            id={view.id}
            saved={view.savedByMe}
            open={!closed}
            noun="group"
          />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-4 bg-slate-2 px-4 py-3">
            <p className="font-mono text-[11px] text-slate-9 uppercase">Owner</p>
            <div className="mt-1.5">
              <MemberLine member={view.owner} size={32} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-4 bg-slate-2 px-4 py-3">
            <p className="font-mono text-[11px] text-slate-9 uppercase">Membership</p>
            <p className="mt-1 text-[14px] font-medium text-slate-12">
              {view.occupancy} / {view.maxOccupancy}, owner included
            </p>
            <div className="mt-2">
              <CapacityMeter filled={view.occupancy} total={view.maxOccupancy} />
            </div>
          </div>
        </div>
        <LinkedText text={view.description} className="mt-5 text-[14.5px] leading-[1.6] text-slate-11" />
        <GroupActions actor={actor} group={view} onDone={setStatus} />
      </Card>
      {member ? (
        <Coordination group={view} />
      ) : (
        <div className="mt-3">
          <Note>
            {closed
              ? 'This group is closed. Coordination details are shown only to its members.'
              : 'The meeting place and coordination details appear only after the owner approves you.'}
          </Note>
        </div>
      )}
      {view.members && (
        <Card className="mt-3 p-5">
          <h3 className="font-display text-[16px] font-bold text-slate-12">
            Owner and members · {view.members.length}
          </h3>
          <MemberList members={view.members} />
        </Card>
      )}
    </>
  )
}

function Coordination({ group }: { group: GroupView }) {
  if (group.coordinationWithheld) {
    return (
      <div className="mt-3">
        <Note tone="amber">Coordination details are hidden while the owner&apos;s account is disabled.</Note>
      </div>
    )
  }
  return (
    <Card className="mt-3 border-iris-6 bg-iris-2 p-5">
      <section aria-label="Private coordination">
        <h3 className="font-display text-[16px] font-bold text-slate-12">Private coordination</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-10">
          Only the owner and accepted members see these details.
        </p>
        {group.coordinationDetails ? (
          <LinkedText text={group.coordinationDetails} className="mt-3 text-[14px] text-slate-12" />
        ) : (
          <p className="mt-3 text-[13.5px] text-slate-10">
            The owner has not added coordination details yet.
          </p>
        )}
      </section>
    </Card>
  )
}

const ACTION_DONE: Record<GroupAction, (group: GroupView) => string> = {
  join: (group) =>
    `Request sent. ${group.owner.displayName} has been notified. No place is reserved until they approve.`,
  withdraw: () => 'Request withdrawn. No place had been reserved.',
  leave: () => 'You left the group. Your place is free and coordination details are no longer shown to you.',
  close: () => 'Group closed. It takes no new members and cannot be reopened.',
}

/** The viewer's next step: ask to join, withdraw, or leave. The owner cannot leave. */
function GroupActions({
  actor,
  group,
  onDone,
}: {
  actor: ActorContextView
  group: GroupView
  onDone: (message: string) => void
}) {
  const action = useGroupAction(actor.accountId)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function run(kind: GroupAction) {
    setError(null)
    action.mutate(
      { id: group.id, action: kind },
      {
        onSuccess: () => {
          setConfirmLeave(false)
          onDone(ACTION_DONE[kind](group))
        },
        onError: (cause) => setError(errorText(cause, 'That did not work. Try again.')),
      },
    )
  }

  let body
  if (group.viewerRelation === 'OWNER') {
    body = (
      <p className="text-[12.5px] leading-relaxed text-slate-10">
        {group.state === 'OPEN'
          ? 'As the owner you cannot leave. Transfer ownership to a member or close the group.'
          : 'This group is closed. Its members keep their coordination access until they leave.'}
      </p>
    )
  } else if (group.viewerRelation === 'MEMBER') {
    body = confirmLeave ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-slate-11">Leave this group? The owner will be notified.</span>
        <Button size="sm" variant="danger" disabled={action.isPending} onClick={() => run('leave')}>
          Confirm leave
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>
          Stay
        </Button>
      </div>
    ) : (
      <Button variant="secondary" onClick={() => setConfirmLeave(true)}>
        Leave group
      </Button>
    )
  } else if (group.viewerRelation === 'PENDING') {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-slate-9" aria-hidden="true" />
          <p className="text-[12.5px] leading-relaxed text-slate-10">
            Awaiting the owner&apos;s approval. A request reserves no place; capacity is checked again on
            approval.
          </p>
        </div>
        <Button variant="secondary" disabled={action.isPending} onClick={() => run('withdraw')}>
          Withdraw request
        </Button>
      </div>
    )
  } else if (group.joinBlock) {
    body = <p className="text-[13.5px] text-slate-10">{JOIN_BLOCK_TEXT[group.joinBlock]}</p>
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] leading-relaxed text-slate-10">
          Only Students can join, with the owner&apos;s approval.
        </p>
        <Button disabled={action.isPending} onClick={() => run('join')}>
          Request to join
        </Button>
      </div>
    )
  }
  return (
    <div className="mt-5 border-t border-slate-4 pt-4">
      {error && (
        <div className="mb-3">
          <Note tone="red">{error}</Note>
        </div>
      )}
      {body}
    </div>
  )
}

const TRANSFER_DONE: Record<TransferAction, string> = {
  accept: 'You now own this group. The former owner stays a member until they leave.',
  decline: 'Offer declined. Ownership is unchanged.',
  cancel: 'Offer cancelled. Ownership is unchanged.',
}

/** The proposed member's answer to an ownership offer. */
function TransferOffer({
  actor,
  transferId,
  from,
  onDone,
}: {
  actor: ActorContextView
  transferId: string
  from: string
  onDone: (message: string) => void
}) {
  const action = useTransferAction(actor.accountId)
  const [error, setError] = useState<string | null>(null)
  function run(kind: TransferAction) {
    setError(null)
    action.mutate(
      { id: transferId, action: kind },
      {
        onSuccess: () => onDone(TRANSFER_DONE[kind]),
        onError: (cause) => setError(errorText(cause, 'That did not work. Try again.')),
      },
    )
  }
  return (
    <Card className="mb-3 border-amber-6 bg-amber-2 p-5">
      <section aria-label="Ownership offer">
        <Badge tone="amber">Your consent is required</Badge>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-12">
          {from} has offered you ownership of this group. You already hold a place, so accepting does not
          change the member count.
        </p>
        {error && (
          <div className="mt-3">
            <Note tone="red">{error}</Note>
          </div>
        )}
        <div className="mt-4 flex gap-2.5">
          <Button disabled={action.isPending} onClick={() => run('accept')}>
            Accept ownership
          </Button>
          <Button variant="secondary" disabled={action.isPending} onClick={() => run('decline')}>
            Decline offer
          </Button>
        </div>
      </section>
    </Card>
  )
}

type Draft = { title: string; description: string; maxOccupancy: string; coordinationDetails: string }

/** The group fields; when and how often you meet go in the description. */
function GroupFields({
  draft,
  errors,
  onChange,
  minOccupancy,
}: {
  draft: Draft
  errors: Record<string, string>
  onChange: (draft: Draft) => void
  minOccupancy: number
}) {
  const set = (key: keyof Draft, value: string) => onChange({ ...draft, [key]: value })
  return (
    <>
      <Field label="Name" required error={errors.title}>
        <TextInput
          name="title"
          value={draft.title}
          maxLength={GROUP_TITLE_MAX}
          invalid={Boolean(errors.title)}
          onChange={(event) => set('title', event.target.value)}
        />
      </Field>
      <Field
        label="Description"
        required
        error={errors.description}
        hint={`What the group does and when it meets. Use #tags to help people find it. ${draft.description.length}/${GROUP_DESCRIPTION_MAX}`}
      >
        <TextArea
          name="description"
          rows={5}
          value={draft.description}
          invalid={Boolean(errors.description)}
          onChange={(event) => set('description', event.target.value)}
        />
      </Field>
      <Field
        label="Maximum members"
        required
        error={errors.maxOccupancy}
        hint={`A whole number from ${minOccupancy} to ${GROUP_OCCUPANCY_MAX}, including you.`}
      >
        <TextInput
          name="maxOccupancy"
          type="number"
          inputMode="numeric"
          min={minOccupancy}
          max={GROUP_OCCUPANCY_MAX}
          step={1}
          value={draft.maxOccupancy}
          invalid={Boolean(errors.maxOccupancy)}
          onChange={(event) => set('maxOccupancy', event.target.value)}
        />
      </Field>
      <Field
        label="Coordination details"
        error={errors.coordinationDetails}
        hint="Meeting place, chat link or contacts. Shown only to you and accepted members."
      >
        <TextArea
          name="coordinationDetails"
          rows={3}
          maxLength={GROUP_COORDINATION_MAX}
          value={draft.coordinationDetails}
          invalid={Boolean(errors.coordinationDetails)}
          onChange={(event) => set('coordinationDetails', event.target.value)}
        />
      </Field>
    </>
  )
}

/** Validates a draft with the shared schema; returns the input or the field errors. */
function parseDraft(draft: Draft): { input: GroupInput } | { errors: Record<string, string> } {
  const input = {
    title: draft.title,
    description: draft.description,
    maxOccupancy: draft.maxOccupancy.trim() === '' ? Number.NaN : Number(draft.maxOccupancy),
    coordinationDetails: draft.coordinationDetails,
  }
  const parsed = groupInputSchema.safeParse(input)
  if (parsed.success) return { input }
  const errors: Record<string, string> = {}
  for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? 'form')] ??= issue.message
  return { errors }
}

/** Server errors on a group form: field errors, a capacity error on the maximum, or a message. */
function submitErrors(
  cause: unknown,
  fallback: string,
): { fields: Record<string, string>; message: string | null } {
  const fields = fieldErrorsOf(cause)
  if (fields) return { fields, message: null }
  if (isApiError(cause) && cause.code === 'CAPACITY_EXCEEDED') {
    return { fields: { maxOccupancy: cause.message }, message: null }
  }
  if (isApiError(cause) && cause.code === 'CONFLICT') {
    return { fields: {}, message: 'This group changed since you opened it. Reload the page and try again.' }
  }
  return { fields: {}, message: errorText(cause, fallback) }
}

/** Create Group: a Student without a restriction becomes its owner and first member. */
export function NewGroup() {
  const actor = useOutletContext<ActorContextView>()
  const navigate = useNavigate()
  const create = useCreateGroup(actor.accountId)
  const [draft, setDraft] = useState<Draft>({
    title: '',
    description: '',
    maxOccupancy: '5',
    coordinationDetails: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const header = <ColumnHeader title="Start a group" subtitle="A study group or student-led activity." />

  if (!canCreateGroup(actor)) {
    return (
      <>
        <BackLink to={ACTIVITIES_PATH}>Activities Board</BackLink>
        {header}
        <Note tone="amber">
          {actor.role === 'STUDENT'
            ? 'You cannot create groups while your account is restricted.'
            : 'Only Students can create groups.'}
        </Note>
      </>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const result = parseDraft(draft)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    create.mutate(result.input, {
      onSuccess: (group) =>
        navigate(groupPath(group.id), {
          replace: true,
          state: { notice: 'Group created. You are its owner and first member.' },
        }),
      onError: (cause) => {
        const next = submitErrors(cause, 'The group could not be created. Try again.')
        setErrors(next.fields)
        setError(next.message)
      },
    })
  }

  return (
    <>
      <BackLink to={ACTIVITIES_PATH}>Activities Board</BackLink>
      {header}
      <Card className="max-w-2xl">
        <form noValidate onSubmit={submit}>
          <div className="space-y-4 px-5 py-4">
            {error && <Note tone="red">{error}</Note>}
            <GroupFields draft={draft} errors={errors} onChange={setDraft} minOccupancy={1} />
            <Note>
              Every membership needs your approval. Pending requests reserve no place; capacity is checked
              again when you approve.
            </Note>
          </div>
          <div className="flex justify-end gap-2.5 border-t border-slate-4 bg-slate-2 px-5 py-3.5">
            <Link to={ACTIVITIES_PATH} className={buttonClass({ variant: 'ghost' })}>
              Cancel
            </Link>
            <Button type="submit" disabled={create.isPending}>
              Create group
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}

/** Manage Group: the owner edits the group, decides join requests, transfers ownership or closes it. */
export function ManageGroup() {
  const actor = useOutletContext<ActorContextView>()
  const { groupId = '' } = useParams()
  const group = useGroup(actor.accountId, groupId)
  if (group.isPending) return <LoadingContent />
  if (group.isError) return <GroupUnavailable error={group.error} onRetry={() => void group.refetch()} />
  const view = group.data
  const back = <BackLink to={groupPath(view.id)}>Group</BackLink>
  if (view.viewerRelation !== 'OWNER' || view.state !== 'OPEN') {
    return (
      <>
        {back}
        <ColumnHeader title="Manage group" />
        <Note tone="amber">
          {view.viewerRelation !== 'OWNER'
            ? 'Only the owner can manage this group.'
            : 'This group is closed and can no longer be changed.'}
        </Note>
      </>
    )
  }
  return (
    <>
      {back}
      <ColumnHeader title="Manage group" subtitle={view.title} />
      <EditGroupCard actor={actor} group={view} />
      <JoinRequests actor={actor} group={view} />
      <Ownership actor={actor} group={view} />
      <CloseGroup actor={actor} group={view} />
    </>
  )
}

function EditGroupCard({ actor, group }: { actor: ActorContextView; group: GroupView }) {
  const edit = useEditGroup(actor.accountId)
  // The version the owner opened; refetches must not reset the form.
  const [version, setVersion] = useState(group.version)
  const [draft, setDraft] = useState<Draft>({
    title: group.title,
    description: group.description,
    maxOccupancy: String(group.maxOccupancy),
    coordinationDetails: group.coordinationDetails ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!canCreateGroup(actor)) {
    return (
      <Card className="p-5">
        <h3 className="font-display text-[16px] font-bold text-slate-12">Group details</h3>
        <div className="mt-3">
          <Note tone="amber">
            You cannot edit the group while your account is restricted. You can still decide requests and
            close it.
          </Note>
        </div>
      </Card>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    const result = parseDraft(draft)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    edit.mutate(
      { id: group.id, input: { ...result.input, version } },
      {
        onSuccess: (updated) => {
          setVersion(updated.version)
          setSaved(true)
        },
        onError: (cause) => {
          const next = submitErrors(cause, 'The changes could not be saved. Try again.')
          setErrors(next.fields)
          setError(next.message)
        },
      },
    )
  }

  return (
    <Card>
      <form noValidate onSubmit={submit} aria-label="Group details">
        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-[16px] font-bold text-slate-12">Group details</h3>
            <CapacityMeter filled={group.occupancy} total={group.maxOccupancy} />
          </div>
          {saved && (
            <div role="status">
              <Note tone="iris">Changes saved.</Note>
            </div>
          )}
          {error && <Note tone="red">{error}</Note>}
          <GroupFields
            draft={draft}
            errors={errors}
            onChange={setDraft}
            minOccupancy={Math.max(1, group.occupancy)}
          />
        </div>
        <div className="flex justify-end border-t border-slate-4 bg-slate-2 px-5 py-3.5">
          <Button type="submit" disabled={edit.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  )
}

function JoinRequests({ actor, group }: { actor: ActorContextView; group: GroupView }) {
  const [page, setPage] = useState(1)
  const requests = useJoinRequests(actor.accountId, group.id, page)
  const decide = useDecideJoinRequest(actor.accountId)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run(request: MembershipView, approve: boolean) {
    setStatus(null)
    setError(null)
    decide.mutate(
      { membershipId: request.id, approve },
      {
        onSuccess: () =>
          setStatus(
            approve
              ? `${request.member.displayName} is now a member and can see the coordination details.`
              : `${request.member.displayName}'s request was declined.`,
          ),
        onError: (cause) => setError(errorText(cause, 'That did not work. Try again.')),
      },
    )
  }

  return (
    <Card className="mt-3 p-5">
      <section aria-label="Join requests">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-[16px] font-bold text-slate-12">
            Join requests{requests.data ? ` · ${requests.data.total}` : ''}
          </h3>
          {isFull(group) && <Badge tone="amber">Full</Badge>}
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-slate-10">
          Oldest first. Requests reserve no place; capacity and eligibility are checked again when you
          approve.
        </p>
        {status && (
          <div className="mt-3" role="status">
            <Note tone="iris">{status}</Note>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Note tone="red">{error}</Note>
          </div>
        )}
        <div className="mt-4">
          {requests.isPending ? (
            <LoadingContent label="Loading requests…" />
          ) : requests.isError ? (
            <ErrorContent message={requests.error.message} onRetry={() => void requests.refetch()} />
          ) : requests.data.items.length === 0 ? (
            <p className="text-[13px] text-slate-10">No pending requests.</p>
          ) : (
            <>
              <ul className="space-y-3">
                {requests.data.items.map((request) => (
                  <li
                    key={request.id}
                    aria-label={`Request from ${request.member.displayName}`}
                    className="rounded-xl border border-slate-5 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <MemberLine
                        member={request.member}
                        size={36}
                        meta={<>Asked {timeAgo(request.requestedAt)}</>}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={decide.isPending || request.approveBlock !== null}
                          onClick={() => run(request, true)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={decide.isPending}
                          onClick={() => run(request, false)}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                    {request.approveBlock && (
                      <p className="mt-2 text-[12px] text-amber-11">
                        {APPROVE_BLOCK_TEXT[request.approveBlock]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Pager
                page={page}
                total={requests.data.total}
                pageSize={requests.data.pageSize}
                onPage={setPage}
                previous="Previous"
                next="Next"
              />
            </>
          )}
        </div>
      </section>
    </Card>
  )
}

function Ownership({ actor, group }: { actor: ActorContextView; group: GroupView }) {
  const propose = useProposeTransfer(actor.accountId)
  const transfer = useTransferAction(actor.accountId)
  const candidates = (group.members ?? []).filter((member) => !member.isOwner && member.member.memberId)
  const [memberId, setMemberId] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chosen = memberId || candidates[0]?.member.memberId || ''
  const pending = group.pendingTransfer?.viewerSide === 'OWNER' ? group.pendingTransfer : null

  function offer() {
    setStatus(null)
    setError(null)
    propose.mutate(
      { groupId: group.id, memberId: chosen },
      {
        onSuccess: (created) =>
          setStatus(
            `Ownership offered to ${created.toMember.displayName}. You stay the owner until they accept.`,
          ),
        onError: (cause) => setError(errorText(cause, 'The offer could not be sent. Try again.')),
      },
    )
  }

  function cancel(id: string) {
    setStatus(null)
    setError(null)
    transfer.mutate(
      { id, action: 'cancel' },
      {
        onSuccess: () => setStatus(TRANSFER_DONE.cancel),
        onError: (cause) => setError(errorText(cause, 'That did not work. Try again.')),
      },
    )
  }

  return (
    <Card className="mt-3 p-5">
      <section aria-label="Ownership">
        <h3 className="font-display text-[16px] font-bold text-slate-12">Ownership</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-10">
          The owner cannot leave. Offer ownership to an accepted member; they must accept. You then stay a
          member and may leave.
        </p>
        {status && (
          <div className="mt-3" role="status">
            <Note tone="iris">{status}</Note>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Note tone="red">{error}</Note>
          </div>
        )}
        <div className="mt-4">
          {pending ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13.5px] text-slate-12">
                Waiting for {pending.toMember.displayName} to answer your offer.
              </p>
              <Button variant="secondary" disabled={transfer.isPending} onClick={() => cancel(pending.id)}>
                Cancel offer
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-[13px] text-slate-10">Approve a member before you can transfer ownership.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="min-w-[220px] flex-1">
                <Field label="New owner">
                  <Select value={chosen} onChange={(event) => setMemberId(event.target.value)}>
                    {candidates.map((member) => (
                      <option key={member.membershipId} value={member.member.memberId ?? ''}>
                        {member.member.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button variant="secondary" disabled={propose.isPending || !chosen} onClick={offer}>
                Offer ownership
              </Button>
            </div>
          )}
        </div>
      </section>
    </Card>
  )
}

function CloseGroup({ actor, group }: { actor: ActorContextView; group: GroupView }) {
  const navigate = useNavigate()
  const action = useGroupAction(actor.accountId)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  function close() {
    setError(null)
    action.mutate(
      { id: group.id, action: 'close' },
      {
        onSuccess: () =>
          navigate(groupPath(group.id), { replace: true, state: { notice: ACTION_DONE.close(group) } }),
        onError: (cause) => setError(errorText(cause, 'The group could not be closed. Try again.')),
      },
    )
  }
  return (
    <Card className="mt-3 p-5">
      <section aria-label="Close group">
        <h3 className="font-display text-[16px] font-bold text-slate-12">Close group</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-10">
          Closing is permanent. Pending requests end and members are notified; they keep the coordination
          details until they leave.
        </p>
        {error && (
          <div className="mt-3">
            <Note tone="red">{error}</Note>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {confirm ? (
            <>
              <span className="text-[13px] text-slate-11">Close this group? It cannot be reopened.</span>
              <Button variant="danger" disabled={action.isPending} onClick={close}>
                Close permanently
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep open
              </Button>
            </>
          ) : (
            <Button variant="dangerGhost" onClick={() => setConfirm(true)}>
              Close group
            </Button>
          )}
        </div>
      </section>
    </Card>
  )
}
