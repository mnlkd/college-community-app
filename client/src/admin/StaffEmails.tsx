import { institutionalEmailSchema, type ActorContextView } from '@hilcoe/shared'
import { Search, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useAddStaffEmail, useRemoveStaffEmail, useStaffEmails } from '../api'
import { ErrorContent, LoadingContent } from '../design/states'
import {
  Badge,
  Button,
  Card,
  ColumnHeader,
  Field,
  Note,
  PanelHead,
  TextInput,
  buttonClass,
} from '../design/ui'
import { Pager, errorMessage, fieldError } from './kit'

export function StaffEmails() {
  const actor = useOutletContext<ActorContextView>()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const list = useStaffEmails(actor.accountId, query, page)
  const add = useAddStaffEmail(actor.accountId)
  const remove = useRemoveStaffEmail(actor.accountId)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const [notice, setNotice] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    setNotice(null)
    const parsed = institutionalEmailSchema.safeParse(email)
    setEmailError(parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Enter a college email'))
    if (!parsed.success) return
    add.mutate(
      { email: parsed.data },
      {
        onSuccess: () => {
          setEmail('')
          setNotice(`${parsed.data} was added to the Staff list.`)
        },
      },
    )
  }

  function search(event: FormEvent) {
    event.preventDefault()
    setQuery(draft.trim())
    setPage(1)
  }

  function removeEmail(value: string) {
    setNotice(null)
    remove.mutate(value, { onSuccess: () => setNotice(`${value} was removed from the Staff list.`) })
  }

  return (
    <>
      <ColumnHeader
        title="Staff email list"
        subtitle="College emails on this list receive the Staff role when they register."
        right={
          <Link to="/admin/users" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Back to users
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-fit p-5">
          <form noValidate onSubmit={submit} className="space-y-4">
            {notice && <Note tone="iris">{notice}</Note>}
            {add.isError && !fieldError(add.error, 'email') && (
              <Note tone="red">{errorMessage(add.error)}</Note>
            )}
            <Field
              label="Staff email"
              required
              hint="Must be a working @hilcoeschool.com mailbox."
              error={emailError ?? fieldError(add.error, 'email')}
            >
              <TextInput
                type="email"
                name="email"
                mono
                value={email}
                invalid={Boolean(emailError)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add Staff email'}
            </Button>
            <Note>
              Changing the list does not change existing accounts. Correct an existing member’s role from
              Manage account.
            </Note>
          </form>
        </Card>
        <Card className="overflow-hidden">
          <PanelHead action={list.data && <Badge tone="blue">{list.data.total} emails</Badge>}>
            Current Staff emails
          </PanelHead>
          <form role="search" onSubmit={search} className="flex gap-2 px-4 pb-3">
            <TextInput
              type="search"
              aria-label="Search Staff emails"
              placeholder="Search Staff emails"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="secondary" aria-label="Search">
              <Search className="size-4" />
            </Button>
          </form>
          {remove.isError && (
            <div className="px-4 pb-3">
              <Note tone="red">{errorMessage(remove.error)}</Note>
            </div>
          )}
          {list.isPending ? (
            <LoadingContent />
          ) : list.isError ? (
            <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <p className="border-t border-slate-4 px-4 py-3 text-[13px] text-slate-10">
              {query ? 'No Staff emails match this search.' : 'The Staff list is empty.'}
            </p>
          ) : (
            <ul aria-label="Staff emails" className="divide-y divide-slate-4 border-t border-slate-4">
              {list.data.items.map((item) => (
                <li key={item.email} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="truncate font-mono text-[13px] text-slate-12">{item.email}</span>
                  <Button
                    size="sm"
                    variant="dangerGhost"
                    disabled={remove.isPending}
                    aria-label={`Remove ${item.email}`}
                    onClick={() => removeEmail(item.email)}
                  >
                    <X className="size-3.5" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {list.data && (
            <div className="px-4 pb-3">
              <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
