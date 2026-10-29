import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { buttonClass } from '../design/ui'

function AuthBrand({ size = 17 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="flex items-center justify-center rounded-[10px] bg-iris-9 shadow-xs"
        style={{ width: size * 1.9, height: size * 1.9 }}
      >
        <GraduationCap
          className="text-white"
          style={{ width: size * 1.1, height: size * 1.1 }}
          strokeWidth={2.3}
        />
      </span>
      <span
        className="font-display font-extrabold tracking-[-0.035em] text-slate-12"
        style={{ fontSize: size }}
      >
        HiLCoE <span className="text-iris-9">Commons</span>
      </span>
    </span>
  )
}

/** Frame for registration, recovery and account-state pages outside the member shell. */
export function AuthShell({
  step,
  title,
  sub,
  children,
  aside,
  headerAction,
}: {
  step?: string
  title: string
  sub?: string
  children: ReactNode
  aside?: ReactNode
  /** Replaces the default "Sign in" link, for example with a sign-out button. */
  headerAction?: ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-iris-3 via-iris-2 to-slate-2">
      <header className="border-b border-iris-5 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center px-6">
          <AuthBrand />
          <div className="ml-auto">
            {headerAction ?? (
              <Link to="/login" className={buttonClass({ variant: 'ghost' })}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1120px] gap-8 px-6 py-12">
        <main className="w-full max-w-[520px]">
          {step && <p className="font-mono text-[11.5px] tracking-[0.08em] text-slate-9 uppercase">{step}</p>}
          <h1 className="font-display mt-2 text-[30px] leading-tight font-extrabold tracking-[-0.038em] text-slate-12">
            {title}
          </h1>
          {sub && <p className="mt-2 max-w-[52ch] text-[14.5px] leading-relaxed text-slate-11">{sub}</p>}
          <div className="mt-8 rounded-2xl border border-slate-5 bg-white p-6 shadow-sm">{children}</div>
        </main>
        {aside && <aside className="hidden w-[340px] shrink-0 space-y-4 lg:block">{aside}</aside>}
      </div>
    </div>
  )
}
