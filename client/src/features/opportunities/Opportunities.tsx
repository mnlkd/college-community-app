import {
  OPPORTUNITY_APPLY_VIA_MAX,
  OPPORTUNITY_DESCRIPTION_MAX,
  OPPORTUNITY_LOCATION_MAX,
  OPPORTUNITY_ORGANIZATION_MAX,
  OPPORTUNITY_TITLE_MAX,
  OPPORTUNITY_TYPES,
  SEARCH_TEXT_MAX,
  WORK_ARRANGEMENTS,
  normalizeTag,
  opportunityInputSchema,
  type ActorContextView,
  type OpportunityInput,
  type OpportunityType,
  type OpportunityView,
  type WorkArrangement,
} from '@hilcoe/shared'
import { Briefcase, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import {
  isApiError,
  useCloseOpportunity,
  useCreateOpportunity,
  useEditOpportunity,
  useOpportunity,
  useOpportunityBoard,
} from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import {
  Badge,
  Button,
  Card,
  ColumnHeader,
  Field,
  Note,
  Select,
  TextArea,
  TextInput,
  buttonClass,
} from '../../design/ui'
import {
  BackLink,
  BoardIntro,
  BoardSearch,
  BoardsHeader,
  OPPORTUNITIES_PATH,
  SaveToggle,
  Segmented,
  pageOf,
} from '../boards/content'
import { ReportLink, canReport } from '../moderation/content'
import { LinkedText, MemberLine, Pager } from '../posts/content'
import { fieldErrorsOf } from '../profile/RoleDetailsFields'
import {
  ARRANGEMENT_LABELS,
  NEW_OPPORTUNITY_PATH,
  TYPE_LABELS,
  canAuthorOpportunity,
  canPostOpportunity,
  editOpportunityPath,
  formatDeadline,
  OpportunityCard,
  opportunityPath,
} from './content'

const isType = (value: string | null): value is OpportunityType =>
  (OPPORTUNITY_TYPES as readonly string[]).includes(value ?? '')
const isArrangement = (value: string | null): value is WorkArrangement =>
  (WORK_ARRANGEMENTS as readonly string[]).includes(value ?? '')

/** The Opportunities Board: open listings by keyword, #tag, type and arrangement; or "My listings". */
export function OpportunitiesBoard() {
  const actor = useOutletContext<ActorContextView>()
  const [params, setParams] = useSearchParams()
  const text = params.get('text') ?? ''
  const tag = normalizeTag(params.get('tag') ?? '') ?? ''
  const typeParam = params.get('type')
  const type = isType(typeParam) ? typeParam : null
  const arrangementParam = params.get('arrangement')
  const workArrangement = isArrangement(arrangementParam) ? arrangementParam : null
  const author = canAuthorOpportunity(actor)
  const mine = author && params.get('mine') === '1'
  const page = pageOf(params)
  const [typed, setTyped] = useState(text)
  const board = useOpportunityBoard(actor.accountId, { text, tag, type, workArrangement, mine }, page)

  function update(
    next: Partial<{
      text: string
      tag: string
      type: OpportunityType | null
      workArrangement: WorkArrangement | null
      mine: boolean
      page: number
    }>,
  ) {
    const copy = new URLSearchParams()
    const values = {
      text: (next.text ?? text).trim(),
      tag: next.tag ?? tag,
      type: next.type === undefined ? type : next.type,
      arrangement: next.workArrangement === undefined ? workArrangement : next.workArrangement,
    }
    for (const [key, value] of Object.entries(values)) if (value) copy.set(key, value)
    if (next.mine ?? mine) copy.set('mine', '1')
    if ((next.page ?? 1) > 1) copy.set('page', String(next.page))
    setParams(copy)
  }

  function submit() {
    const value = typed.trim()
    const asTag = /^#\S+$/.test(value) ? normalizeTag(value) : null
    if (asTag) {
      setTyped('')
      update({ text: '', tag: asTag })
    } else update({ text: value })
  }

  const filtered = text !== '' || tag !== '' || type !== null || workArrangement !== null
  return (
    <>
      <BoardsHeader
        active="OPPORTUNITIES"
        right={
          canPostOpportunity(actor) && (
            <Link to={NEW_OPPORTUNITY_PATH} className={buttonClass({ size: 'sm' })}>
              <Plus className="size-3.5" aria-hidden="true" /> Post an opportunity
            </Link>
          )
        }
      />
      <BoardSearch
        label="Search opportunities"
        placeholder="Search opportunity keywords, or #tag"
        value={typed}
        maxLength={SEARCH_TEXT_MAX}
        onChange={setTyped}
        onSubmit={submit}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {author && (
          <Segmented
            label="Show listings"
            value={mine ? 'mine' : 'open'}
            options={[
              { value: 'open', label: 'Open listings' },
              { value: 'mine', label: 'My listings' },
            ]}
            onChange={(value) => update({ mine: value === 'mine' })}
          />
        )}
        <label className="flex items-center gap-1.5 text-[12.5px] text-slate-10">
          <span>Type</span>
          <Select
            className="h-8! w-auto! text-[13px]!"
            value={type ?? ''}
            onChange={(event) => update({ type: isType(event.target.value) ? event.target.value : null })}
          >
            <option value="">Any</option>
            {OPPORTUNITY_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-slate-10">
          <span>Arrangement</span>
          <Select
            className="h-8! w-auto! text-[13px]!"
            value={workArrangement ?? ''}
            onChange={(event) =>
              update({ workArrangement: isArrangement(event.target.value) ? event.target.value : null })
            }
          >
            <option value="">Any</option>
            {WORK_ARRANGEMENTS.map((value) => (
              <option key={value} value={value}>
                {ARRANGEMENT_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        {tag && (
          <Badge tone="iris">
            #{tag}
            <button type="button" aria-label={`Remove tag filter ${tag}`} onClick={() => update({ tag: '' })}>
              <X className="size-3" />
            </button>
          </Badge>
        )}
      </div>
      <BoardIntro>
        {mine
          ? 'Your listings in every state, open ones first. A closed listing keeps only its title, type and status.'
          : 'Staff and Verified Alumni share informational listings. Apply externally; applications are not tracked here.'}
      </BoardIntro>
      {board.isPending ? (
        <LoadingContent label="Loading opportunities…" />
      ) : board.isError ? (
        <ErrorContent message={board.error.message} onRetry={() => void board.refetch()} />
      ) : board.data.items.length === 0 ? (
        <Note>
          {page > 1
            ? 'No more listings.'
            : filtered
              ? 'No listings match these filters.'
              : mine
                ? 'You have not posted any listings yet.'
                : 'No open listings right now. Check back later.'}
        </Note>
      ) : (
        <>
          <div className="space-y-3">
            {board.data.items.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} actor={actor} />
            ))}
          </div>
          <Pager
            page={page}
            total={board.data.total}
            pageSize={board.data.pageSize}
            onPage={(next) => update({ page: next })}
            previous="Previous"
            next="Next"
          />
        </>
      )}
    </>
  )
}

function OpportunityUnavailable({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isApiError(error) && error.status === 404) {
    return (
      <>
        <BackLink to={OPPORTUNITIES_PATH}>Opportunities Board</BackLink>
        <ColumnHeader title="Listing unavailable" />
        <Note>This listing does not exist or is not available to you.</Note>
      </>
    )
  }
  return <ErrorContent message={error.message} onRetry={onRetry} />
}

/** A listing. A closed one shows only its title, type and status, to its author too. */
export function OpportunityDetail() {
  const actor = useOutletContext<ActorContextView>()
  const { opportunityId = '' } = useParams()
  const listing = useOpportunity(actor.accountId, opportunityId)
  const [closedNow, setClosedNow] = useState(false)
  if (listing.isPending) return <LoadingContent />
  if (listing.isError) {
    return <OpportunityUnavailable error={listing.error} onRetry={() => void listing.refetch()} />
  }
  const view = listing.data
  return (
    <>
      <BackLink to={OPPORTUNITIES_PATH}>Opportunities Board</BackLink>
      <ColumnHeader title="Opportunity" />
      {closedNow && (
        <div className="mb-3" role="status">
          <Note tone="iris">Listing closed. Only its title, type and status remain visible.</Note>
        </div>
      )}
      {view.details ? (
        <OpenListing actor={actor} view={view} onClosed={() => setClosedNow(true)} />
      ) : (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-[21px] font-extrabold tracking-[-0.03em] text-slate-12">
              {view.title}
            </h2>
            <SaveToggle
              actor={actor}
              type="OPPORTUNITY"
              id={view.id}
              saved={view.savedByMe}
              open={false}
              noun="listing"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Badge>{TYPE_LABELS[view.type]}</Badge>
            <Badge>Closed</Badge>
            {view.state === 'CLOSED' && canReport(actor, view.isOwn) && (
              <span className="ml-auto">
                <ReportLink
                  type="OPPORTUNITY"
                  id={view.id}
                  context={{
                    back: `/boards/opportunities/listings/${view.id}`,
                    author: null,
                    excerpt: view.title,
                  }}
                />
              </span>
            )}
          </div>
        </Card>
      )}
    </>
  )
}

function OpenListing({
  actor,
  view,
  onClosed,
}: {
  actor: ActorContextView
  view: OpportunityView
  onClosed: () => void
}) {
  const close = useCloseOpportunity(actor.accountId)
  const [confirm, setConfirm] = useState(false)
  const details = view.details
  if (!details) return null
  const open = view.state === 'OPEN'

  function closeListing() {
    close.mutate(view.id, {
      onSuccess: () => {
        setConfirm(false)
        onClosed()
      },
    })
  }

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-iris-9 to-iris-10 shadow-sm">
            <Briefcase className="size-5 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[21px] leading-tight font-extrabold tracking-[-0.03em] break-words text-slate-12">
              {view.title}
            </h2>
            <p className="mt-1 text-[14.5px] text-slate-11">{details.organization}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="iris">{TYPE_LABELS[view.type]}</Badge>
              <Badge>{ARRANGEMENT_LABELS[details.workArrangement]}</Badge>
              <Badge>{details.location}</Badge>
              {details.deadline && <Badge tone="amber">Apply by {formatDeadline(details.deadline)}</Badge>}
              {view.state === 'HIDDEN' && <Badge tone="red">Hidden by moderation</Badge>}
            </div>
          </div>
          <SaveToggle
            actor={actor}
            type="OPPORTUNITY"
            id={view.id}
            saved={view.savedByMe}
            open={open}
            noun="listing"
          />
        </div>
        <div className="mt-5 rounded-2xl border border-slate-4 bg-slate-2 p-4">
          <p className="font-mono text-[11.5px] tracking-[0.04em] text-slate-9 uppercase">Apply externally</p>
          <LinkedText text={details.applyVia} className="mt-1 text-[14px] text-slate-12" />
          <p className="mt-1.5 text-[12.5px] text-slate-10">
            Follow these instructions. No application is submitted or tracked in this app.
          </p>
        </div>
      </Card>
      <Card className="mt-3 p-5">
        <h3 className="font-display text-[16px] font-bold tracking-[-0.02em] text-slate-12">
          About the role
        </h3>
        <LinkedText text={details.description} className="mt-2 text-[14.5px] leading-[1.6] text-slate-11" />
      </Card>
      <Card className="mt-3 p-5">
        <p className="mb-2.5 font-mono text-[11.5px] tracking-[0.04em] text-slate-9 uppercase">Posted by</p>
        <div className="flex items-center justify-between gap-3">
          <MemberLine member={details.author} />
          {view.state !== 'HIDDEN' && canReport(actor, view.isOwn) && (
            <ReportLink
              type="OPPORTUNITY"
              id={view.id}
              context={{
                back: `/boards/opportunities/listings/${view.id}`,
                author: details.author.displayName,
                excerpt: `${view.title} · ${details.organization}`,
              }}
            />
          )}
        </div>
      </Card>
      {view.isOwn && open && (
        <Card className="mt-3 p-5">
          <h3 className="font-display text-[16px] font-bold text-slate-12">Manage this listing</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-slate-10">
            Closing is permanent. Everyone, you included, then sees only the title, type and Closed status.
          </p>
          {close.error && (
            <div className="mt-3">
              <Note tone="red">{close.error.message}</Note>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {canPostOpportunity(actor) && (
              <Link to={editOpportunityPath(view.id)} className={buttonClass({ variant: 'secondary' })}>
                Edit listing
              </Link>
            )}
            {confirm ? (
              <>
                <span className="text-[13px] text-slate-11">Close this listing? It cannot be reopened.</span>
                <Button variant="danger" disabled={close.isPending} onClick={closeListing}>
                  Close permanently
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Keep open
                </Button>
              </>
            ) : (
              <Button variant="dangerGhost" onClick={() => setConfirm(true)}>
                Close listing
              </Button>
            )}
          </div>
        </Card>
      )}
    </>
  )
}

type Draft = {
  title: string
  organization: string
  location: string
  type: OpportunityType
  workArrangement: WorkArrangement
  description: string
  applyVia: string
  deadline: string
}

const EMPTY: Draft = {
  title: '',
  organization: '',
  location: '',
  type: 'INTERNSHIP',
  workArrangement: 'ON_SITE',
  description: '',
  applyVia: '',
  deadline: '',
}

function OpportunityForm({
  initial,
  submitLabel,
  cancelTo,
  pending,
  error,
  serverErrors,
  onSubmit,
}: {
  initial: Draft
  submitLabel: string
  cancelTo: string
  pending: boolean
  error: string | null
  serverErrors: Record<string, string>
  onSubmit: (input: OpportunityInput) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const errors = { ...serverErrors, ...clientErrors }
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    const input = { ...draft, deadline: draft.deadline || null }
    const parsed = opportunityInputSchema.safeParse(input)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= issue.message
      setClientErrors(next)
      return
    }
    setClientErrors({})
    onSubmit(input)
  }

  return (
    <Card className="max-w-2xl">
      <form noValidate onSubmit={submit}>
        <div className="space-y-4 px-5 py-4">
          {error && <Note tone="red">{error}</Note>}
          <Field label="Role title" required error={errors.title}>
            <TextInput
              name="title"
              value={draft.title}
              maxLength={OPPORTUNITY_TITLE_MAX}
              invalid={Boolean(errors.title)}
              onChange={(event) => set('title', event.target.value)}
            />
          </Field>
          <Field label="Organisation" required error={errors.organization}>
            <TextInput
              name="organization"
              value={draft.organization}
              maxLength={OPPORTUNITY_ORGANIZATION_MAX}
              invalid={Boolean(errors.organization)}
              onChange={(event) => set('organization', event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employment type" required error={errors.type}>
              <Select
                name="type"
                value={draft.type}
                onChange={(event) => isType(event.target.value) && set('type', event.target.value)}
              >
                {OPPORTUNITY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work arrangement" required error={errors.workArrangement}>
              <Select
                name="workArrangement"
                value={draft.workArrangement}
                onChange={(event) =>
                  isArrangement(event.target.value) && set('workArrangement', event.target.value)
                }
              >
                {WORK_ARRANGEMENTS.map((value) => (
                  <option key={value} value={value}>
                    {ARRANGEMENT_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Location" required error={errors.location}>
              <TextInput
                name="location"
                value={draft.location}
                maxLength={OPPORTUNITY_LOCATION_MAX}
                invalid={Boolean(errors.location)}
                onChange={(event) => set('location', event.target.value)}
              />
            </Field>
            <Field
              label="Application deadline"
              error={errors.deadline}
              hint="Shown on the listing; it never closes it."
            >
              <TextInput
                name="deadline"
                type="date"
                value={draft.deadline}
                invalid={Boolean(errors.deadline)}
                onChange={(event) => set('deadline', event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Description"
            required
            error={errors.description}
            hint={`Use #tags to help people find it. ${draft.description.length}/${OPPORTUNITY_DESCRIPTION_MAX}`}
          >
            <TextArea
              name="description"
              rows={6}
              value={draft.description}
              invalid={Boolean(errors.description)}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>
          <Field
            label="How to apply"
            required
            error={errors.applyVia}
            hint="An external link or contact method. Applications are not tracked here."
          >
            <TextInput
              name="applyVia"
              value={draft.applyVia}
              maxLength={OPPORTUNITY_APPLY_VIA_MAX}
              invalid={Boolean(errors.applyVia)}
              onChange={(event) => set('applyVia', event.target.value)}
            />
          </Field>
          <Note>
            Closing is permanent. Everyone then sees only the title, employment type and Closed status, in
            search and saved items too.
          </Note>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-4 bg-slate-2 px-5 py-3.5">
          <Link to={cancelTo} className={buttonClass({ variant: 'ghost' })}>
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function useSubmitErrors() {
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  function fail(cause: unknown, fallback: string) {
    const fields = fieldErrorsOf(cause)
    if (fields) setServerErrors(fields)
    else if (isApiError(cause) && cause.code === 'CONFLICT')
      setError('This listing changed since you opened it. Reload the page to edit the latest version.')
    else setError(isApiError(cause) ? cause.message : fallback)
  }
  function reset() {
    setServerErrors({})
    setError(null)
  }
  return { serverErrors, error, fail, reset }
}

/** Post an opportunity: Staff and Verified Alumni without a restriction. */
export function NewOpportunity() {
  const actor = useOutletContext<ActorContextView>()
  const navigate = useNavigate()
  const create = useCreateOpportunity(actor.accountId)
  const { serverErrors, error, fail, reset } = useSubmitErrors()
  const header = (
    <ColumnHeader
      title="Post an opportunity"
      subtitle="An informational listing on the Opportunities Board."
    />
  )
  if (!canPostOpportunity(actor)) {
    return (
      <>
        <BackLink to={OPPORTUNITIES_PATH}>Opportunities Board</BackLink>
        {header}
        <Note tone="amber">
          {canAuthorOpportunity(actor)
            ? 'You cannot post listings while your account is restricted.'
            : 'Only Staff and Verified Alumni can post opportunities.'}
        </Note>
      </>
    )
  }
  return (
    <>
      <BackLink to={OPPORTUNITIES_PATH}>Opportunities Board</BackLink>
      {header}
      <OpportunityForm
        initial={EMPTY}
        submitLabel="Publish listing"
        cancelTo={OPPORTUNITIES_PATH}
        pending={create.isPending}
        error={error}
        serverErrors={serverErrors}
        onSubmit={(input) => {
          reset()
          create.mutate(input, {
            onSuccess: (created) => navigate(opportunityPath(created.id), { replace: true }),
            onError: (cause) => fail(cause, 'The listing could not be published. Try again.'),
          })
        }}
      />
    </>
  )
}

/** Edit an open listing, carrying the version the author opened. */
export function EditOpportunity() {
  const actor = useOutletContext<ActorContextView>()
  const { opportunityId = '' } = useParams()
  const listing = useOpportunity(actor.accountId, opportunityId)
  if (listing.isPending) return <LoadingContent />
  if (listing.isError) {
    return <OpportunityUnavailable error={listing.error} onRetry={() => void listing.refetch()} />
  }
  return <EditForm actor={actor} view={listing.data} />
}

function EditForm({ actor, view }: { actor: ActorContextView; view: OpportunityView }) {
  const navigate = useNavigate()
  const edit = useEditOpportunity(actor.accountId)
  const { serverErrors, error, fail, reset } = useSubmitErrors()
  // The version the author opened; a refetch must not move it forward.
  const [opened] = useState(view)
  const details = opened.details
  const back = opportunityPath(view.id)
  const header = <ColumnHeader title="Edit your opportunity" />
  if (!view.isOwn || view.state !== 'OPEN' || !details || !canPostOpportunity(actor)) {
    return (
      <>
        <BackLink to={back}>Listing</BackLink>
        {header}
        <Note tone="amber">
          {!view.isOwn
            ? 'Only the author can edit this listing.'
            : view.state !== 'OPEN'
              ? 'A closed listing cannot be edited.'
              : 'You cannot edit listings while your account is restricted.'}
        </Note>
      </>
    )
  }
  return (
    <>
      <BackLink to={back}>Listing</BackLink>
      {header}
      <OpportunityForm
        initial={{
          title: opened.title,
          organization: details.organization,
          location: details.location,
          type: opened.type,
          workArrangement: details.workArrangement,
          description: details.description,
          applyVia: details.applyVia,
          deadline: details.deadline ?? '',
        }}
        submitLabel="Save changes"
        cancelTo={back}
        pending={edit.isPending}
        error={error}
        serverErrors={serverErrors}
        onSubmit={(input) => {
          reset()
          edit.mutate(
            { id: view.id, input: { ...input, version: details.version } },
            {
              onSuccess: () => navigate(back, { replace: true }),
              onError: (cause) => fail(cause, 'The changes could not be saved. Try again.'),
            },
          )
        }}
      />
    </>
  )
}
