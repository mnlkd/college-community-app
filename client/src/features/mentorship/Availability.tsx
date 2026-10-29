import {
  CONTACT_KINDS,
  MENTOR_CAPACITY_MAX,
  MENTOR_CONTACT_VALUE_MAX,
  MENTOR_INTRODUCTION_MAX,
  MENTOR_TOPICS_MAX,
  MENTOR_TOPIC_MAX,
  mentorProfileInputSchema,
  type ActorContextView,
  type ContactKind,
  type MentorProfileInput,
  type OwnMentorSettingsView,
} from '@hilcoe/shared'
import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { isApiError, useOwnMentorSettings, useUpdateMentorSettings } from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import {
  Badge,
  Button,
  Card,
  ColumnHeader,
  Field,
  LinkTabs,
  Note,
  TextArea,
  TextInput,
  Toggle,
  buttonClass,
} from '../../design/ui'
import { AVAILABILITY_PATH, BOARD_PATH, CONTACT_LABELS, MY_REQUESTS_PATH } from './content'

const CONTACT_FIELD_LABELS: Record<ContactKind, string> = {
  EMAIL: 'Email address to share',
  TELEGRAM: 'Telegram username to share',
  PHONE: 'Phone number to share',
  OTHER: 'Other contact method',
}

interface Draft {
  available: boolean
  capacity: string
  introduction: string
  topics: string[]
  contacts: Record<ContactKind, { on: boolean; value: string }>
}

function draftOf(view: OwnMentorSettingsView): Draft {
  const contacts = Object.fromEntries(
    CONTACT_KINDS.map((kind) => {
      const existing = view.contacts.find((contact) => contact.kind === kind)
      return [kind, { on: existing !== undefined, value: existing?.value ?? '' }]
    }),
  ) as Draft['contacts']
  return {
    available: view.configured ? view.available : true,
    capacity: String(view.capacity),
    introduction: view.introduction ?? '',
    topics: view.topics,
    contacts,
  }
}

function inputOf(draft: Draft): { input: MentorProfileInput; kinds: ContactKind[] } {
  const kinds = CONTACT_KINDS.filter((kind) => draft.contacts[kind].on)
  const capacity = draft.capacity.trim() === '' ? Number.NaN : Number(draft.capacity)
  return {
    kinds,
    input: {
      available: draft.available,
      capacity,
      introduction: draft.introduction,
      topics: draft.topics,
      contacts: kinds.map((kind) => ({ kind, value: draft.contacts[kind].value })),
    },
  }
}

/** Field keys from a validation path: contact values are keyed by kind, topic items by "topics". */
function fieldKey(path: readonly PropertyKey[], kinds: ContactKind[]): string {
  const [head, index] = path
  if (head === 'contacts' && typeof index === 'number') return `contacts.${kinds[index] ?? ''}`
  return String(head ?? 'form')
}

/** Manage Mentor Availability: listing, capacity, topics, introduction and the contacts to share. */
export function MentorAvailability() {
  const actor = useOutletContext<ActorContextView>()
  const settings = useOwnMentorSettings(actor.accountId)
  const header = (
    <ColumnHeader
      title="My Requests"
      subtitle="Your mentorship availability and the contacts you choose to share."
      tabs={
        <LinkTabs
          tabs={[
            { key: 'requests', label: 'Requests', to: `${MY_REQUESTS_PATH}?tab=requests` },
            { key: 'mentees', label: 'Current mentees', to: `${MY_REQUESTS_PATH}?tab=mentees` },
            { key: 'history', label: 'History', to: `${MY_REQUESTS_PATH}?tab=history` },
            { key: 'availability', label: 'My availability', to: AVAILABILITY_PATH },
          ]}
          active="availability"
        />
      }
    />
  )
  if (settings.isPending) return <LoadingContent />
  if (settings.isError) {
    if (isApiError(settings.error) && settings.error.status === 403) {
      return (
        <>
          <ColumnHeader title="Mentor availability" />
          <Note>Only Staff and Verified Alumni can offer mentorship.</Note>
        </>
      )
    }
    return <ErrorContent message={settings.error.message} onRetry={() => void settings.refetch()} />
  }
  return (
    <>
      {header}
      <AvailabilityForm accountId={actor.accountId} settings={settings.data} />
    </>
  )
}

function AvailabilityForm({ accountId, settings }: { accountId: string; settings: OwnMentorSettingsView }) {
  const update = useUpdateMentorSettings(accountId)
  const [draft, setDraft] = useState<Draft>(() => draftOf(settings))
  const [topic, setTopic] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  function change(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }))
    setSaved(null)
  }

  function setContact(kind: ContactKind, next: Partial<{ on: boolean; value: string }>) {
    change({ contacts: { ...draft.contacts, [kind]: { ...draft.contacts[kind], ...next } } })
  }

  function addTopic() {
    const value = topic.trim()
    if (!value) return
    if (draft.topics.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setErrors({ ...errors, topics: 'That topic is already listed.' })
      return
    }
    if (draft.topics.length >= MENTOR_TOPICS_MAX) {
      setErrors({ ...errors, topics: `At most ${MENTOR_TOPICS_MAX} topics.` })
      return
    }
    change({ topics: [...draft.topics, value] })
    setTopic('')
    setErrors({ ...errors, topics: '' })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const { input, kinds } = inputOf(draft)
    const parsed = mentorProfileInputSchema.safeParse(input)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) next[fieldKey(issue.path, kinds)] ??= issue.message
      setErrors(next)
      return
    }
    setErrors({})
    update.mutate(input, {
      onSuccess: (view) => {
        setDraft(draftOf(view))
        setSaved(
          view.available
            ? 'Availability saved. You are listed on the Mentorship Board while you have open places.'
            : 'Availability saved. You are hidden from new requests; your pending requests and mentees are kept.',
        )
      },
      onError: (cause) => {
        if (isApiError(cause) && cause.fields) {
          const next: Record<string, string> = {}
          for (const [key, message] of Object.entries(cause.fields))
            next[
              fieldKey(
                key.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
                kinds,
              )
            ] ??= message
          setErrors(next)
        } else
          setError(isApiError(cause) ? cause.message : 'Your availability could not be saved. Try again.')
      },
    })
  }

  return (
    <form noValidate onSubmit={submit}>
      {saved && (
        <div className="mb-3" role="status">
          <Note tone="iris">{saved}</Note>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Note tone="red">{error}</Note>
        </div>
      )}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-display text-[15px] font-bold text-slate-12">
              List me on the Mentorship Board
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-10">
              Turning this off hides you from new requests. Your mentees and pending requests are kept, and
              you can still accept a pending request while you have places.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.available}
            aria-label="List me on the Mentorship Board"
            onClick={() => change({ available: !draft.available })}
            className="shrink-0"
          >
            <Toggle on={draft.available} />
          </button>
        </div>
      </Card>
      <Card className="mt-3 space-y-4 p-5">
        <Field
          label="Maximum active mentees"
          required
          error={errors.capacity}
          hint={`${settings.activeCount} currently active. A whole number from 1 to ${MENTOR_CAPACITY_MAX}.`}
        >
          <TextInput
            type="number"
            name="capacity"
            min={1}
            max={MENTOR_CAPACITY_MAX}
            step={1}
            value={draft.capacity}
            invalid={Boolean(errors.capacity)}
            onChange={(event) => change({ capacity: event.target.value })}
          />
        </Field>
        <div>
          <Field
            label="Mentorship topics"
            error={errors.topics || undefined}
            hint={`Up to ${MENTOR_TOPICS_MAX}. Students choose one when they ask for mentorship.`}
          >
            <div className="flex gap-2">
              <TextInput
                name="topic"
                value={topic}
                maxLength={MENTOR_TOPIC_MAX}
                placeholder="For example, Backend APIs"
                onChange={(event) => setTopic(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTopic()
                  }
                }}
              />
              <Button
                variant="secondary"
                onClick={addTopic}
                disabled={draft.topics.length >= MENTOR_TOPICS_MAX}
              >
                Add topic
              </Button>
            </div>
          </Field>
          {draft.topics.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Topics">
              {draft.topics.map((each) => (
                <li key={each}>
                  <Badge tone="iris">
                    {each}
                    <button
                      type="button"
                      aria-label={`Remove topic ${each}`}
                      onClick={() => change({ topics: draft.topics.filter((value) => value !== each) })}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field
          label="Mentorship introduction"
          error={errors.introduction}
          hint={`Shown on the board and your mentor profile. ${draft.introduction.length}/${MENTOR_INTRODUCTION_MAX}`}
        >
          <TextArea
            name="introduction"
            rows={3}
            value={draft.introduction}
            invalid={Boolean(errors.introduction)}
            onChange={(event) => change({ introduction: event.target.value })}
          />
        </Field>
      </Card>
      <Card className="mt-3 space-y-4 p-5">
        <div>
          <h2 className="font-display text-[16px] font-bold text-slate-12">
            Contact methods you choose to share
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-10">
            Choose at least one. Only Students in an active mentorship with you see these details. Your
            account email is never shared automatically.
          </p>
        </div>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Contact methods</legend>
          {CONTACT_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-[13.5px] text-slate-12">
              <input
                type="checkbox"
                checked={draft.contacts[kind].on}
                onChange={(event) => setContact(kind, { on: event.target.checked })}
                className="size-4 accent-iris-9"
              />
              {CONTACT_LABELS[kind]}
            </label>
          ))}
        </fieldset>
        {errors.contacts && (
          <p role="alert" className="text-[12.5px] text-red-11">
            {errors.contacts}
          </p>
        )}
        {CONTACT_KINDS.filter((kind) => draft.contacts[kind].on).map((kind) => (
          <Field key={kind} label={CONTACT_FIELD_LABELS[kind]} required error={errors[`contacts.${kind}`]}>
            <TextInput
              name={`contact-${kind.toLowerCase()}`}
              value={draft.contacts[kind].value}
              maxLength={MENTOR_CONTACT_VALUE_MAX}
              mono={kind !== 'OTHER'}
              invalid={Boolean(errors[`contacts.${kind}`])}
              onChange={(event) => setContact(kind, { value: event.target.value })}
            />
          </Field>
        ))}
      </Card>
      <div className="mt-4 flex justify-end gap-2.5">
        <Link to={BOARD_PATH} className={buttonClass({ variant: 'ghost' })}>
          Back to the board
        </Link>
        <Button type="submit" disabled={update.isPending}>
          Save availability
        </Button>
      </div>
    </form>
  )
}
