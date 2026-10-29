import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  profileInputSchema,
  roleDetailsIssues,
  type ActorContextView,
  type OwnAccountView,
  type ProfileInput,
} from '@hilcoe/shared'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  isApiError,
  useOwnAccount,
  useRemoveProfilePicture,
  useUpdateProfile,
  useUploadProfilePicture,
} from '../../api'
import { ROLE_LABELS } from '../../design/content'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Avatar, Button, Card, ColumnHeader, Field, Note, TextArea, TextInput } from '../../design/ui'
import {
  RoleDetailsFields,
  fieldErrorsOf,
  roleDetailsInput,
  roleDetailsValues,
  type RoleDetailsValues,
} from './RoleDetailsFields'

const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PICTURE_MAX_BYTES = 5 * 1024 * 1024

/** Client-side check for quick feedback; the server re-checks and re-encodes every image. */
export function pictureProblem(file: { type: string; size: number }): string | null {
  if (!PICTURE_TYPES.includes(file.type) || file.size > PICTURE_MAX_BYTES) {
    return 'Choose a JPEG, PNG or WebP image no larger than 5 MB.'
  }
  return null
}

export function EditProfile() {
  const actor = useOutletContext<ActorContextView>()
  const account = useOwnAccount(actor.accountId)
  if (account.isPending) return <LoadingContent />
  if (account.isError)
    return <ErrorContent message={account.error.message} onRetry={() => void account.refetch()} />
  return <EditProfileForm accountId={actor.accountId} account={account.data} />
}

function PictureSection({ accountId, account }: { accountId: string; account: OwnAccountView }) {
  const upload = useUploadProfilePicture(accountId)
  const remove = useRemoveProfilePicture(accountId)
  const [error, setError] = useState<string | null>(null)
  const picture = account.profile.pictureUrl
  const busy = upload.isPending || remove.isPending

  function messageOf(cause: unknown): string {
    const fields = fieldErrorsOf(cause)
    if (fields?.picture) return fields.picture
    return isApiError(cause) ? cause.message : 'The picture could not be saved. Try again.'
  }

  function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = pictureProblem(file)
    setError(problem)
    if (problem) return
    upload.mutate(file, { onError: (cause) => setError(messageOf(cause)) })
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name={account.displayName} src={picture ?? undefined} size={64} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer rounded-lg border border-slate-7 bg-white px-3 py-2 text-[13px] font-semibold text-slate-12 hover:bg-slate-2">
            {upload.isPending ? 'Uploading…' : picture ? 'Replace picture' : 'Upload picture'}
            <input
              aria-label="Profile picture"
              type="file"
              accept={PICTURE_TYPES.join(',')}
              className="sr-only"
              disabled={busy}
              onChange={select}
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={!picture || busy}
            onClick={() => {
              setError(null)
              remove.mutate(undefined, { onError: (cause) => setError(messageOf(cause)) })
            }}
          >
            Remove picture
          </Button>
        </div>
        <p className="text-[11.5px] text-slate-10">JPEG, PNG or WebP · up to 5 MB · initials when removed</p>
        {error && (
          <p role="alert" className="text-[12.5px] text-red-11">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function EditProfileForm({ accountId, account }: { accountId: string; account: OwnAccountView }) {
  const navigate = useNavigate()
  const update = useUpdateProfile(accountId)
  const currentYear = new Date().getUTCFullYear()
  const { profile, role } = account
  const [displayName, setDisplayName] = useState(account.displayName)
  const [bio, setBio] = useState(profile.bio ?? '')
  const [details, setDetails] = useState<RoleDetailsValues>(roleDetailsValues(profile))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const input: ProfileInput = { displayName, bio, ...roleDetailsInput(role, details) }
    const parsed = profileInputSchema.safeParse(input)
    const next: Record<string, string> = {}
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= issue.message
    } else {
      Object.assign(next, roleDetailsIssues(role, parsed.data, currentYear))
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    update.mutate(input, {
      onSuccess: () => navigate('/profile'),
      onError: (cause) => {
        const fields = fieldErrorsOf(cause)
        if (fields) setErrors(fields)
        else setError(isApiError(cause) ? cause.message : 'The profile could not be saved. Try again.')
      },
    })
  }

  const bioLength = Array.from(bio).length
  return (
    <>
      <ColumnHeader title="Edit my profile" subtitle="A picture and bio are optional." />
      <Card className="max-w-2xl p-5">
        <div className="space-y-4">
          <PictureSection accountId={accountId} account={account} />
          <p className="text-[13px] text-slate-11">
            <strong>{account.displayName}</strong> · {ROLE_LABELS[role]}. Your role is not editable here.
          </p>
          <form noValidate onSubmit={submit} className="space-y-4">
            {error && <Note tone="red">{error}</Note>}
            <Field
              label="Display name"
              required
              hint={`At most ${DISPLAY_NAME_MAX} characters.`}
              error={errors.displayName}
            >
              <TextInput
                name="displayName"
                value={displayName}
                invalid={Boolean(errors.displayName)}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Field label="Bio" hint={`Optional. ${bioLength} / ${BIO_MAX} characters`} error={errors.bio}>
              <TextArea
                name="bio"
                rows={3}
                value={bio}
                invalid={Boolean(errors.bio)}
                onChange={(event) => setBio(event.target.value)}
              />
            </Field>
            <RoleDetailsFields
              role={role}
              values={details}
              errors={errors}
              onChange={setDetails}
              currentYear={currentYear}
              showStudy
            />
            <Note>
              Your profile is visible to signed-in members. Your account email and private activity are not
              profile fields.
            </Note>
            <div className="flex justify-end gap-2.5">
              <Button variant="ghost" onClick={() => navigate('/profile')}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </>
  )
}
