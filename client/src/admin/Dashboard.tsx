// Administrator dashboard: View Analytics and Export CSV (FR-11).
import {
  ANALYTICS_WINDOW_DEFAULT,
  type ActorContextView,
  type AnalyticsWindow,
  type DashboardSummaryView,
} from '@hilcoe/shared'
import { Flag, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useAnalytics, useExportAnalytics } from '../api'
import { Badge, Button, Card, ColumnHeader, LinkTabs, Note, PanelHead, buttonClass, cx } from '../design/ui'
import { ErrorContent, LoadingContent } from '../design/states'
import { errorMessage } from './kit'

function windowOf(value: string | null): AnalyticsWindow {
  return value === '7' ? 7 : value === '30' ? 30 : ANALYTICS_WINDOW_DEFAULT
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <p className="font-mono text-[11.5px] tracking-[0.04em] text-slate-10 uppercase">{label}</p>
      <p
        className="mt-1.5 font-display text-[27px] leading-none font-extrabold tracking-[-0.035em] text-slate-12 tabular-nums"
        data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-10">{sub}</p>
    </Card>
  )
}

/** Posts plus comments per UTC day, oldest first, scaled to the busiest day. */
function ActivityChart({ summary }: { summary: DashboardSummaryView }) {
  const totals = summary.dailyActivity.map((day) => day.posts + day.comments)
  const peak = Math.max(1, ...totals)
  return (
    <figure>
      <div className="flex h-24 items-end gap-[3px]" aria-hidden="true">
        {totals.map((total, index) => (
          <div
            key={summary.dailyActivity[index]?.date}
            className={cx(
              'flex-1 rounded-[3px]',
              total === 0 ? 'bg-slate-4' : index === totals.length - 1 ? 'bg-iris-9' : 'bg-iris-6',
            )}
            style={{ height: total === 0 ? '3px' : `${Math.max(6, (total / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-slate-10" aria-hidden="true">
        <span>{summary.from}</span>
        <span>Today (UTC)</span>
      </div>
      <figcaption className="sr-only">
        Posts and comments per UTC day from {summary.from} to {summary.to}
      </figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Posts</th>
            <th scope="col">Comments</th>
          </tr>
        </thead>
        <tbody>
          {summary.dailyActivity.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.posts}</td>
              <td>{day.comments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function RoleBars({ summary }: { summary: DashboardSummaryView }) {
  const { byRole, administrators, communityAccounts } = summary.accountCounts
  const rows: [string, number, string][] = [
    ['Students', byRole.STUDENT, 'bg-iris-9'],
    ['Alumni', byRole.ALUMNI, 'bg-amber-9'],
    ['Staff', byRole.STAFF, 'bg-blue-9'],
    ['Administrators', administrators, 'bg-slate-8'],
  ]
  const total = communityAccounts + administrators
  return (
    <Card className="p-4">
      <h2 className="font-display text-[15px] font-bold tracking-[-0.02em] text-slate-12">
        Accounts by role · total {total}
      </h2>
      <ul className="mt-4 space-y-3">
        {rows.map(([label, count, colour]) => (
          <li key={label}>
            <div className="flex justify-between text-[13px] text-slate-11">
              <span>{label}</span>
              <span className="font-mono">{count}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-4" aria-hidden="true">
              <div
                className={cx('h-full rounded-full', colour)}
                style={{ width: `${total === 0 ? 0 : (count / total) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Attention({ summary }: { summary: DashboardSummaryView }) {
  const items: { icon: LucideIcon; count: number; title: string; sub: string; to: string }[] = [
    {
      icon: Flag,
      count: summary.pendingReports,
      title: plural(summary.pendingReports, 'content report'),
      sub: 'Posts, comments and opportunities awaiting a decision',
      to: '/admin/moderation',
    },
    {
      icon: ShieldCheck,
      count: summary.pendingAlumniReviews,
      title: plural(summary.pendingAlumniReviews, 'self-reported Alumni account'),
      sub: 'Name, programme and graduation-year corroboration',
      to: '/admin/users?tab=reviews',
    },
    {
      icon: Users,
      count: summary.pendingGraduationRequests,
      title: plural(summary.pendingGraduationRequests, 'graduation request'),
      sub: 'Students asking to become Alumni',
      to: '/admin/users?tab=graduation',
    },
  ]
  const pending = items.reduce((sum, item) => sum + item.count, 0)
  return (
    <Card>
      <PanelHead
        action={
          <Badge tone={pending > 0 ? 'amber' : 'green'}>
            {pending > 0 ? plural(pending, 'pending item') : 'All clear'}
          </Badge>
        }
      >
        Needs your attention
      </PanelHead>
      <ul className="divide-y divide-slate-4 border-t border-slate-4">
        {items.map(({ icon: Icon, title, sub, to }) => (
          <li key={to} className="flex items-center gap-3 px-4 py-3.5">
            <Icon className="size-5 shrink-0 text-iris-11" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-slate-12">{title}</p>
              <p className="text-[12px] text-slate-10">{sub}</p>
            </div>
            <Link
              to={to}
              className={buttonClass({ variant: 'secondary', size: 'sm' })}
              aria-label={`Review ${title}`}
            >
              Review
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function StatusAggregates({ summary }: { summary: DashboardSummaryView }) {
  const { byAlumniStatus, byState, communityAccounts, administrators } = summary.accountCounts
  return (
    <Card>
      <PanelHead>Current status and board aggregates</PanelHead>
      <div className="space-y-2 border-t border-slate-4 px-4 py-3 text-[13px] text-slate-11">
        <p>
          {byAlumniStatus.VERIFIED} Verified Alumni · {byAlumniStatus.SELF_REPORTED} Self-Reported ·{' '}
          {byAlumniStatus.FLAGGED} Flagged
        </p>
        <p>
          {byState.DISABLED} disabled · {plural(communityAccounts, 'community account')} +{' '}
          {plural(administrators, 'Administrator')}
        </p>
        <p>
          {plural(summary.openOpportunities, 'open opportunity', 'open opportunities')} ·{' '}
          {plural(summary.activeGroups, 'active group')}
        </p>
        <p>{plural(summary.activeMentorships, 'active mentorship relationship')}</p>
      </div>
    </Card>
  )
}

function Summary({ summary }: { summary: DashboardSummaryView }) {
  const days = summary.windowDays
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Active members"
          value={String(summary.activeMembers)}
          sub={`Of ${plural(summary.accountCounts.communityAccounts, 'community account')}; posted, commented or liked`}
        />
        <Stat
          label="Posts / comments"
          value={`${summary.totalPosts} / ${summary.totalComments}`}
          sub={`Created in the last ${days} days`}
        />
        <Stat
          label="Pending reports"
          value={String(summary.pendingReports)}
          sub="Posts, comments and opportunities"
        />
        <Stat
          label="Alumni reviews"
          value={String(summary.pendingAlumniReviews)}
          sub="Self-Reported Alumni awaiting review"
        />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[15px] font-bold tracking-[-0.02em] text-slate-12">
              Posting activity
            </h2>
            <span className="font-mono text-[11.5px] text-slate-10">posts + comments per day</span>
          </div>
          <div className="mt-5">
            <ActivityChart summary={summary} />
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-slate-10">
            Active members are based on meaningful member actions. Polling and Administrator activity are
            excluded.
          </p>
        </Card>
        <RoleBars summary={summary} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Attention summary={summary} />
        <StatusAggregates summary={summary} />
      </div>
    </>
  )
}

export function Dashboard() {
  const actor = useOutletContext<ActorContextView>()
  const [params] = useSearchParams()
  const windowDays = windowOf(params.get('period'))
  const analytics = useAnalytics(actor.accountId, windowDays)
  const exportCsv = useExportAnalytics()

  return (
    <>
      <ColumnHeader
        title="Administrator dashboard"
        subtitle="Aggregate counts only. Days are UTC calendar days."
        right={
          <Button
            size="sm"
            variant="secondary"
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate(windowDays)}
          >
            {exportCsv.isPending ? 'Exporting…' : 'Export aggregate CSV'}
          </Button>
        }
        tabs={
          <LinkTabs
            tabs={[
              { key: '7', label: 'Last 7 days', to: '/admin?period=7' },
              { key: '30', label: 'Last 30 days', to: '/admin?period=30' },
            ]}
            active={String(windowDays)}
          />
        }
      />
      {exportCsv.isError && (
        <div className="mb-3">
          <Note tone="red">{errorMessage(exportCsv.error)}</Note>
        </div>
      )}
      {analytics.isPending ? (
        <LoadingContent />
      ) : analytics.isError ? (
        <ErrorContent message={analytics.error.message} onRetry={() => void analytics.refetch()} />
      ) : (
        <Summary summary={analytics.data} />
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[12px] leading-relaxed text-slate-10">
          The CSV contains non-personal aggregates only: no names, emails or content.
        </p>
        <Link to="/admin/settings" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          Account settings
        </Link>
      </div>
    </>
  )
}
