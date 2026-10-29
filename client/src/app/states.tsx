import { Link } from 'react-router-dom'
import { Button, ColumnHeader, Note, buttonClass } from '../design/ui'

export { ErrorContent, LoadingContent } from '../design/states'

export function AccessDeniedContent({
  message,
  onSignOut,
  otherShell,
}: {
  message: string
  onSignOut: () => void
  otherShell: { to: string; label: string }
}) {
  return (
    <div className="space-y-4">
      <ColumnHeader title="Access denied" />
      <Note tone="red">{message}</Note>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSignOut}>Sign out</Button>
        <Link to={otherShell.to} className={buttonClass({ variant: 'secondary' })}>
          {otherShell.label}
        </Link>
      </div>
    </div>
  )
}
