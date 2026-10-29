import { Button, Card, ColumnHeader, Note, Shimmer } from './ui'

/** Loading state that keeps the page structure (43-loading-state, NFR-3). */
export function LoadingContent({ label = 'Loading…' }: { label?: string }) {
  return (
    <div aria-busy="true">
      <div className="mb-5 space-y-2">
        <Shimmer w={140} h={26} />
        <Shimmer w={220} />
      </div>
      <div className="space-y-3">
        {[3, 2, 3].map((count, index) => (
          <Card key={index} className="flex gap-3 p-5">
            <span className="size-11 shrink-0 rounded-full bg-slate-3" />
            <div className="flex-1 space-y-4">
              <Shimmer w="35%" />
              {Array.from({ length: count }, (_, line) => (
                <Shimmer key={line} w={line === count - 1 ? '65%' : '100%'} />
              ))}
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-5 text-center text-[13px] text-slate-9" role="status">
        {label}
      </p>
    </div>
  )
}

export function ErrorContent({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="space-y-4">
      <ColumnHeader title="Something went wrong" />
      <Note tone="red">{message}</Note>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
