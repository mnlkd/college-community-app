import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Bell,
  ChartNoAxesColumn,
  Flag,
  GraduationCap,
  Home,
  Inbox,
  LayoutGrid,
  LogOut,
  Mail,
  Menu,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { Avatar, IconButton, cx } from '../design/ui'

export function Wordmark({ size = 17, to = '/home' }: { size?: number; to?: string }) {
  const mark = Math.round(size * 1.9)
  return (
    <Link to={to} className="inline-flex items-center gap-2.5">
      <span
        className="flex items-center justify-center bg-iris-9 shadow-xs"
        style={{ width: mark, height: mark, borderRadius: mark * 0.31 }}
      >
        <GraduationCap
          style={{ width: mark * 0.58, height: mark * 0.58 }}
          className="text-white"
          strokeWidth={2.3}
        />
      </span>
      <span
        className="font-display font-extrabold tracking-[-0.035em] text-slate-12"
        style={{ fontSize: size }}
      >
        HiLCoE <span className="text-iris-9">Commons</span>
      </span>
    </Link>
  )
}

export interface ShellIdentity {
  /** Shown in the top bar: the member's display name, or the Administrator's email. */
  name: string
  roleLabel: string
  pictureUrl?: string
}

/** The Administrator's email, role and sign-out button in the top bar. */
function AdminIdentity({ identity, onSignOut }: { identity: ShellIdentity; onSignOut?: () => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden text-right sm:block">
        <p className="font-display max-w-[240px] truncate text-[13.5px] leading-tight font-bold tracking-[-0.015em] text-slate-12">
          {identity.name}
        </p>
        <p className="text-[11.5px] leading-tight text-slate-10" data-testid="shell-role">
          {identity.roleLabel}
        </p>
      </div>
      <Avatar name={identity.name} size={34} src={identity.pictureUrl} />
      {onSignOut && (
        <IconButton aria-label="Sign out" title="Sign out" onClick={onSignOut}>
          <LogOut className="size-[18px]" />
        </IconButton>
      )}
    </div>
  )
}

/** The member's notifications bell and profile picture; sign-out lives on the profile page. */
function MemberIdentity({ identity, unread }: { identity: ShellIdentity; unread: number }) {
  const { pathname } = useLocation()
  return (
    <div className="flex items-center gap-2">
      <Link
        to="/notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-current={pathname === '/notifications' ? 'page' : undefined}
        title="Notifications"
        className={cx(
          'relative flex size-9 items-center justify-center rounded-full transition-colors duration-150',
          pathname === '/notifications' ? 'bg-iris-3 text-iris-11' : 'text-slate-11 hover:bg-slate-3',
        )}
      >
        <Bell className="size-[19px]" strokeWidth={2} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-iris-9 px-1 text-center text-[10.5px] leading-[18px] font-bold text-white ring-2 ring-white"
            data-testid="notification-badge"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      <Link
        to="/profile"
        aria-label={`${identity.name}, your profile`}
        aria-current={pathname === '/profile' ? 'page' : undefined}
        title="Your profile"
        className="rounded-full"
      >
        <Avatar name={identity.name} size={34} src={identity.pictureUrl} />
      </Link>
    </div>
  )
}

function TopBar({
  admin,
  identity,
  unread,
  onSignOut,
  onMenu,
}: {
  admin?: boolean
  identity?: ShellIdentity
  unread: number
  onSignOut?: () => void
  onMenu: () => void
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-4 bg-white">
      <div className="mx-auto flex h-[60px] max-w-[1480px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton aria-label="Open navigation" className="lg:hidden" onClick={onMenu}>
            <Menu className="size-5" />
          </IconButton>
          <Wordmark to={admin ? '/admin' : '/home'} />
        </div>
        {identity &&
          (admin ? (
            <AdminIdentity identity={identity} onSignOut={onSignOut} />
          ) : (
            <MemberIdentity identity={identity} unread={unread} />
          ))}
      </div>
    </header>
  )
}

/** `also` lists other path prefixes that belong to the item; `badgeLabel` is read after its count. */
type NavItem = { to: string; label: string; icon: typeof Home; also?: string[]; badgeLabel?: string }

const memberNav: NavItem[] = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/boards/opportunities', label: 'Boards', icon: LayoutGrid, also: ['/boards'] },
  {
    to: '/boards/mentorship/my-requests',
    label: 'My Requests',
    icon: Inbox,
    also: ['/boards/mentorship/requests', '/boards/mentorship/availability'],
  },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/** Counts shown beside navigation items, keyed by path. */
export type NavBadges = Partial<Record<string, number>>

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: ChartNoAxesColumn },
  { to: '/admin/users', label: 'Users', icon: Users, badgeLabel: 'awaiting review' },
  { to: '/admin/moderation', label: 'Moderation', icon: Flag, badgeLabel: 'pending reports' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { to: '/admin/staff-emails', label: 'Staff emails', icon: Mail },
  { to: '/admin/administrators', label: 'Administrators', icon: ShieldCheck },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

/** How closely an item matches the path: the length of its longest matching prefix, or -1. */
function matchLength(item: NavItem, pathname: string): number {
  let best = -1
  for (const prefix of [item.to, ...(item.also ?? [])]) {
    const exact = pathname === prefix
    const nested = prefix !== '/home' && prefix !== '/admin' && pathname.startsWith(prefix + '/')
    if ((exact || nested) && prefix.length > best) best = prefix.length
  }
  return best
}

function NavList({ admin, badges, label }: { admin?: boolean; badges?: NavBadges; label: string }) {
  const { pathname } = useLocation()
  const items = admin ? adminNav : memberNav
  // Only the closest item is current, so "My Requests" wins over "Boards" beneath it.
  const lengths = items.map((item) => matchLength(item, pathname))
  const current = Math.max(...lengths)
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map((item, index) => {
        const on = current >= 0 && lengths[index] === current
        const Icon = item.icon
        const count = badges?.[item.to] ?? 0
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'group flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors duration-150',
              on ? 'bg-iris-3' : 'hover:bg-slate-3',
            )}
          >
            <Icon
              className={cx('size-[18px]', on ? 'text-iris-11' : 'text-slate-10 group-hover:text-slate-12')}
              strokeWidth={on ? 2.3 : 1.9}
            />
            <span
              className={cx(
                'font-display text-[14px] tracking-[-0.012em]',
                on ? 'font-bold text-iris-11' : 'font-semibold text-slate-11 group-hover:text-slate-12',
              )}
            >
              {item.label}
            </span>
            {count > 0 && (
              <span
                className="ml-auto min-w-5 rounded-full bg-iris-9 px-1.5 text-center text-[11px] leading-5 font-bold text-white"
                data-testid={`nav-badge-${item.label.toLowerCase()}`}
              >
                {count > 99 ? '99+' : count}
                <span className="sr-only"> {item.badgeLabel ?? 'pending'}</span>
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

function LeftRail({ admin, badges }: { admin?: boolean; badges?: NavBadges }) {
  return (
    <aside className="sticky top-[60px] hidden w-[228px] shrink-0 flex-col self-start px-3 py-5 lg:flex">
      <NavList admin={admin} badges={badges} label={admin ? 'Administrator' : 'Main'} />
    </aside>
  )
}

/** The navigation on screens narrower than the left rail: a modal panel opened from the top bar. */
function NavDrawer({ admin, badges, onClose }: { admin?: boolean; badges?: NavBadges; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const { pathname, search } = useLocation()
  const opened = useRef(pathname + search)

  useEffect(() => {
    if (pathname + search !== opened.current) onClose()
  }, [pathname, search, onClose])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.querySelector<HTMLElement>('[data-drawer-close]')?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('a, button')]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-slate-12/30" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col gap-4 overflow-y-auto bg-white px-3 py-4 shadow-lg"
      >
        <div className="flex items-center justify-between px-2">
          <Wordmark size={15} to={admin ? '/admin' : '/home'} />
          <IconButton aria-label="Close navigation" data-drawer-close onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <NavList admin={admin} badges={badges} label={admin ? 'Administrator' : 'Main'} />
      </div>
    </div>
  )
}

export function AppShell({
  admin,
  identity,
  badges,
  onSignOut,
  rail,
  children,
}: {
  admin?: boolean
  identity?: ShellIdentity
  badges?: NavBadges
  onSignOut?: () => void
  /** Right-hand column shown on wide screens. */
  rail?: ReactNode
  children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  return (
    <div className="min-h-screen bg-slate-2">
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-white px-3 py-2 text-[14px] font-semibold text-iris-11 shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopBar
        admin={admin}
        identity={identity}
        unread={badges?.['/notifications'] ?? 0}
        onSignOut={onSignOut}
        onMenu={() => setMenuOpen(true)}
      />
      {menuOpen && <NavDrawer admin={admin} badges={badges} onClose={closeMenu} />}
      <div className="mx-auto flex max-w-[1480px] gap-7 px-4 sm:px-6">
        <LeftRail admin={admin} badges={badges} />
        <main id="main" tabIndex={-1} className="min-w-0 max-w-[980px] flex-1 py-6 focus:outline-none">
          {children}
        </main>
        {rail && (
          <aside className="sticky top-[60px] hidden w-[330px] shrink-0 flex-col gap-4 self-start py-5 pr-2 xl:flex">
            {rail}
          </aside>
        )}
      </div>
    </div>
  )
}
