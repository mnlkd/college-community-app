import { Link } from 'react-router-dom'
import { buttonClass } from '../design/ui'
import { Wordmark } from './AppShell'

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-2 px-6 text-center">
      <Wordmark size={20} />
      <h1 className="font-display text-[23px] font-extrabold tracking-[-0.035em] text-slate-12">
        Page not found
      </h1>
      <p className="text-[14px] text-slate-11">The page you asked for does not exist.</p>
      <Link to="/home" className={buttonClass()}>
        Go to Home
      </Link>
    </div>
  )
}
