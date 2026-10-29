import type { ActorContextView, Board, SaveTargetType } from '@hilcoe/shared'
import { ArrowLeft, Bookmark, Search as SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isApiError, useToggleSave } from '../../api'
import { Button, ColumnHeader, LinkTabs, cx } from '../../design/ui'
import { canInteract } from '../posts/eligibility'

export const OPPORTUNITIES_PATH = '/boards/opportunities'
export const ACTIVITIES_PATH = '/boards/activities'
export const MENTORSHIP_PATH = '/boards/mentorship'

const TABS: { key: Board; label: string; to: string }[] = [
  { key: 'OPPORTUNITIES', label: 'Opportunities', to: OPPORTUNITIES_PATH },
  { key: 'ACTIVITIES', label: 'Activities', to: ACTIVITIES_PATH },
  { key: 'MENTORSHIP', label: 'Mentorship', to: MENTORSHIP_PATH },
]

/** The "Boards" title with a tab per board. */
export function BoardsHeader({ active, right }: { active: Board; right?: ReactNode }) {
  return (
    <ColumnHeader
      title="Boards"
      subtitle="Opportunities, student-led activities and study groups, and mentorship."
      right={right}
      tabs={<LinkTabs tabs={TABS} active={active} />}
    />
  )
}

export function BoardIntro({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-[13px] leading-relaxed text-slate-10">{children}</p>
}

/** A quiet "← … Board" link above a board page's title. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-10 hover:text-slate-12"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" /> {children}
    </Link>
  )
}

/** A segmented control, as on the Mentorship Board. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-slate-5 bg-slate-2 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors',
            value === option.value ? 'bg-white text-slate-12 shadow-xs' : 'text-slate-10 hover:text-slate-12',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Save or unsave a listing or group. Removing a save is always allowed; a new save needs an
 * eligible account and an open item. The server checks again.
 */
export function SaveToggle({
  actor,
  type,
  id,
  saved,
  open,
  noun,
}: {
  actor: ActorContextView
  type: Extract<SaveTargetType, 'OPPORTUNITY' | 'GROUP'>
  id: string
  saved: boolean
  open: boolean
  noun: string
}) {
  const save = useToggleSave(actor.accountId)
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant="secondary"
        aria-pressed={saved}
        aria-label={saved ? `Remove ${noun} from saved items` : `Save ${noun}`}
        disabled={save.isPending || (!saved && (!canInteract(actor) || !open))}
        onClick={() => save.mutate({ type, id, save: !saved })}
      >
        <Bookmark className={cx('size-3.5', saved && 'fill-current')} aria-hidden="true" />
        {saved ? 'Saved' : 'Save'}
      </Button>
      {save.error && (
        <span role="alert" className="mt-1 text-[12px] text-red-11">
          {isApiError(save.error) && save.error.status === 409
            ? `This ${noun} can no longer be saved.`
            : save.error.message}
        </span>
      )}
    </span>
  )
}

/** A small label with an icon. */
export function Pill({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-5 bg-slate-2 px-2 py-0.5 text-[11.5px] text-slate-11">
      {icon}
      {children}
    </span>
  )
}

/** The page number from `?page=`, at least 1. */
export function pageOf(params: URLSearchParams): number {
  return Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
}

/** The board's search box: a keyword, or a lone #word as a tag filter. */
export function BoardSearch({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  maxLength,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  maxLength: number
}) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="mb-3 flex gap-2"
    >
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-slate-5 bg-white px-3.5 shadow-xs focus-within:border-iris-8">
        <SearchIcon className="size-4 shrink-0 text-slate-9" aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input
          type="search"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none! focus-visible:outline-none!"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  )
}
