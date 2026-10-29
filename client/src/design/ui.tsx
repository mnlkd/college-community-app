import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link } from 'react-router-dom'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
}

const variants = {
  primary: 'bg-iris-9 text-white hover:bg-iris-10 shadow-xs',
  secondary: 'bg-white text-slate-12 border border-slate-7 hover:bg-slate-2',
  ghost: 'text-slate-11 hover:bg-slate-3 hover:text-slate-12',
  danger: 'bg-red-9 text-white hover:brightness-95 shadow-xs',
  dangerGhost: 'text-red-11 border border-red-7 bg-white hover:bg-red-3/60',
}

const sizes = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-9.5 px-4 text-[14px] rounded-[10px] gap-2',
  lg: 'h-11 px-5 text-[15px] rounded-xl gap-2',
}

/** Button styling, also used for links that look like buttons. */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  block,
}: Pick<ButtonProps, 'variant' | 'size' | 'block'> = {}): string {
  return cx(
    'font-display inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap',
    'transition-[transform,background-color,border-color] duration-150 ease-[var(--ease-out-strong)]',
    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
    variants[variant],
    sizes[size],
    block && 'w-full',
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button {...rest} type={type} className={cx(buttonClass({ variant, size, block }), className)}>
      {children}
    </button>
  )
}

export function IconButton({
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-full text-slate-11',
        'transition-[transform,background-color,color] duration-150 ease-[var(--ease-out-strong)]',
        'hover:bg-slate-3 hover:text-slate-12 active:scale-[0.94]',
        className,
      )}
    >
      {children}
    </button>
  )
}

export type Tone = 'iris' | 'neutral' | 'amber' | 'red' | 'blue' | 'green'

const tones: Record<Tone, string> = {
  iris: 'bg-iris-3 text-iris-11 border-iris-6',
  neutral: 'bg-slate-3 text-slate-11 border-slate-6',
  amber: 'bg-amber-2 text-amber-11 border-amber-6',
  red: 'bg-red-3 text-red-11 border-red-6',
  blue: 'bg-blue-3 text-blue-11 border-blue-6',
  green: 'bg-green-3 text-green-11 border-green-6',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <span
      className={cx(
        'font-display inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[11.5px] font-semibold tracking-[-0.005em]',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

const avatarPalette = ['#D2431F', '#0B68CB', '#0F7A6B', '#C2298A', '#7B4BD1', '#9A5C00', '#1F7A3E', '#B4232A']

export function initialsOf(name: string): string {
  return name
    .replace(/^(Dr|Mr|Ms|Mrs)\.?\s+/i, '')
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

export function Avatar({
  name,
  size = 40,
  ring,
  src,
}: {
  name: string
  size?: number
  ring?: boolean
  src?: string
}) {
  const seed = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return (
    <span
      className={cx(
        'font-display inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white',
        ring && 'ring-2 ring-white',
      )}
      style={{
        width: size,
        height: size,
        background: avatarPalette[seed % avatarPalette.length],
        fontSize: size * 0.38,
        letterSpacing: '-0.02em',
      }}
    >
      {src ? (
        <img src={src} alt={`${name}'s profile picture`} className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}

export function Card({
  children,
  className,
  hover,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}) {
  const tinted = /(^|\s)bg-/.test(className ?? '')
  const bordered = /(^|\s)border-(?!\d)/.test(className ?? '')
  return (
    <div
      className={cx(
        'rounded-xl border',
        !bordered && 'border-slate-5',
        !tinted && 'bg-white',
        hover && 'transition-[border-color,box-shadow] duration-150 hover:border-slate-7 hover:shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-slate-5 bg-white', className)}>{children}</div>
}

export function PanelHead({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
      <h3 className="font-display text-[15px] font-bold tracking-[-0.02em] text-slate-12">{children}</h3>
      {action}
    </div>
  )
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] leading-tight font-extrabold tracking-[-0.035em] text-slate-12">
          {title}
        </h1>
        {sub && <p className="mt-1 text-[14px] leading-relaxed text-slate-11">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="font-display mb-1.5 flex items-baseline gap-1 text-[13px] font-semibold text-slate-12">
        {label}
        {required && (
          <span className="text-red-11" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-[12px] leading-relaxed text-red-11">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-[12px] leading-relaxed text-slate-10">{hint}</span>
      )}
    </label>
  )
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; invalid?: boolean }

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { mono, invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(
        'h-10 w-full rounded-[10px] border bg-white px-3 text-[14px] text-slate-12 shadow-xs placeholder:text-slate-9',
        'focus-visible:border-iris-8 disabled:opacity-60',
        invalid ? 'border-red-7' : 'border-slate-7',
        mono && 'font-mono text-[13px]',
        className,
      )}
    />
  )
})

const controlClass = (invalid: boolean | undefined) =>
  cx(
    'w-full rounded-[10px] border bg-white px-3 text-[14px] text-slate-12 shadow-xs placeholder:text-slate-9',
    'focus-visible:border-iris-8 disabled:opacity-60',
    invalid ? 'border-red-7' : 'border-slate-7',
  )

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      className={cx(controlClass(invalid), 'h-10', className)}
    >
      {children}
    </select>
  )
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }

export function TextArea({ invalid, className, rows = 3, ...rest }: TextAreaProps) {
  return (
    <textarea
      {...rest}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(controlClass(invalid), 'py-2 leading-relaxed', className)}
    />
  )
}

export function Note({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'amber' | 'red' | 'iris'
  children: ReactNode
}) {
  const styles = {
    neutral: 'border-slate-5 bg-slate-2 text-slate-11',
    amber: 'border-amber-6 bg-amber-2 text-amber-12',
    red: 'border-red-6 bg-red-2 text-red-12',
    iris: 'border-iris-6 bg-iris-2 text-iris-12',
  }
  return (
    <div
      role={tone === 'red' ? 'alert' : undefined}
      className={cx('rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed', styles[tone])}
    >
      {children}
    </div>
  )
}

export function Shimmer({ w, h = 12, rounded = 6 }: { w: number | string; h?: number; rounded?: number }) {
  return <span className="block bg-slate-3" style={{ width: w, height: h, borderRadius: rounded }} />
}

export function ColumnHeader({
  title,
  subtitle,
  right,
  tabs,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  tabs?: ReactNode
}) {
  return (
    <div className="mb-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight font-extrabold tracking-[-0.038em] text-slate-12">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-[14px] leading-relaxed text-slate-11">{subtitle}</p>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
      {tabs && <div className="mt-4 border-b border-slate-5">{tabs}</div>}
    </div>
  )
}

/** Tabs as links, so each list has its own address. */
export function LinkTabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; to: string }[]
  active: string
}) {
  return (
    <nav className="-mb-px flex gap-5 overflow-x-auto" aria-label="Lists">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          aria-current={tab.key === active ? 'page' : undefined}
          className={cx(
            'border-b-2 pb-2.5 text-[14px] font-semibold whitespace-nowrap transition-colors',
            tab.key === active
              ? 'border-iris-9 text-slate-12'
              : 'border-transparent text-slate-10 hover:text-slate-12',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

/** Filled places out of a capacity, as segments (up to six) or a bar. */
export function CapacityMeter({ filled, total }: { filled: number; total: number }) {
  const label = `${filled} of ${total} places filled`
  const pct = total === 0 ? 0 : Math.min(100, (filled / total) * 100)
  return (
    <div className="flex min-w-0 items-center gap-2" role="img" aria-label={label}>
      {total <= 6 ? (
        <div className="flex min-w-0 gap-1">
          {Array.from({ length: total }).map((_, index) => (
            <span
              key={index}
              className={cx(
                'h-1.5 w-5 min-w-1.5 shrink rounded-full',
                index < filled ? 'bg-iris-9' : 'bg-slate-5',
              )}
            />
          ))}
        </div>
      ) : (
        <div className="h-1.5 w-24 min-w-0 overflow-hidden rounded-full bg-slate-5">
          <span className="block h-full rounded-full bg-iris-9" style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-slate-10" aria-hidden="true">
        {filled}/{total}
      </span>
    </div>
  )
}

/** A switch; the caller supplies the button with role="switch". */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-[var(--ease-out-strong)]',
        on ? 'bg-iris-9' : 'bg-slate-7',
      )}
    >
      <span
        className="absolute size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-out-strong)]"
        style={{ transform: on ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </span>
  )
}
