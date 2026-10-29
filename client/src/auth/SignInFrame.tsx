import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { Card } from '../design/ui'

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

export function SignInFrame({
  admin = false,
  title,
  sub,
  children,
  footer,
}: {
  admin?: boolean
  title: string
  sub: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-iris-4 via-iris-2 to-slate-1">
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-7 text-center">
            <AuthBrand size={26} />
            <p className="mt-2.5 text-[14px] leading-relaxed text-slate-11">
              {admin ? 'Separate Administrator access' : 'The HiLCoE community, in one place.'}
            </p>
          </div>
          <Card className="p-7 shadow-sm">
            <h1 className="font-display text-center text-[23px] font-extrabold tracking-[-0.035em] text-slate-12">
              {title}
            </h1>
            <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-slate-10">{sub}</p>
            <div className="mt-6">{children}</div>
            {footer}
          </Card>
          <Link
            to={admin ? '/login' : '/admin/login'}
            className="mt-4 block text-center text-[13px] font-medium text-slate-10 hover:text-slate-12"
          >
            {admin ? 'Member sign in' : 'Administrator sign in'}
          </Link>
        </div>
      </div>
      <footer className="border-t border-iris-5 bg-white/60 px-6 py-5 text-center text-[12px] text-slate-9">
        © {new Date().getFullYear()} HiLCoE Commons
      </footer>
    </div>
  )
}
