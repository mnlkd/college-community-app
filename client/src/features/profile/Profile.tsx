import type { ActorContextView, ProfileView } from '@hilcoe/shared'
import { Briefcase, CalendarDays, GraduationCap, LogOut } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { isApiError, useMentorProfile, useOwnAccount, useProfile } from '../../api'
import { signOut } from '../../auth'
import { PROGRAMME_LABELS, RoleChip } from '../../design/content'
import { LoadingContent } from '../../design/states'
import { Avatar, Button, Card, ColumnHeader, Note, buttonClass } from '../../design/ui'
import { mentorPath } from '../mentorship/content'

function yearLabel(profile: ProfileView): string | null {
  if (profile.graduationYear === null) return null
  return profile.role === 'STUDENT'
    ? `Expected graduation ${profile.graduationYear}`
    : `Graduated ${profile.graduationYear}`
}

export function ProfileCard({ profile, own }: { profile: ProfileView; own: boolean }) {
  const year = yearLabel(profile)
  return (
    <Card className="overflow-hidden">
      <div className="h-24 bg-iris-3" />
      <div className="px-5 pb-5">
        <div className="-mt-11 flex items-end justify-between gap-3">
          <span className="rounded-full ring-4 ring-white">
            <Avatar name={profile.displayName} src={profile.pictureUrl ?? undefined} size={84} />
          </span>
          {own && (
            <Link to="/profile/edit" className={buttonClass({ variant: 'secondary' })}>
              Edit profile
            </Link>
          )}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-[22px] font-extrabold tracking-[-0.032em] text-slate-12">
            {profile.displayName}
          </h2>
          <RoleChip role={profile.role} alumniStatus={profile.alumniStatus} />
        </div>
        {profile.bio && (
          <p className="mt-3 max-w-[58ch] text-[14.5px] leading-[1.6] whitespace-pre-line text-slate-11 [overflow-wrap:anywhere]">
            {profile.bio}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-slate-11">
          {profile.programme && (
            <span className="inline-flex items-center gap-1.5">
              <GraduationCap className="size-4" />
              {PROGRAMME_LABELS[profile.programme]}
            </span>
          )}
          {profile.studyOrExpertise && (
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="size-4" />
              {profile.studyOrExpertise}
            </span>
          )}
          {year && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" />
              {year}
            </span>
          )}
        </div>
        {profile.currentPosition && (
          <p className="mt-2 text-[13px] text-slate-11">
            <strong>Current position:</strong> {profile.currentPosition}
          </p>
        )}
      </div>
    </Card>
  )
}

function ProfileError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const status = isApiError(error) ? error.status : null
  return (
    <>
      <ColumnHeader title="Profile unavailable" />
      <div className="space-y-4">
        {status === 404 ? (
          <Note>This profile does not exist or is not available.</Note>
        ) : (
          <Note tone="red">{error.message}</Note>
        )}
        {status !== 404 && status !== 403 && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </>
  )
}

/** The signed-in member's own profile. */
export function MyProfile() {
  const actor = useOutletContext<ActorContextView>()
  const account = useOwnAccount(actor.accountId)
  if (account.isPending) return <LoadingContent />
  if (account.isError) return <ProfileError error={account.error} onRetry={() => void account.refetch()} />
  return (
    <>
      <ColumnHeader
        title="My profile"
        subtitle="Visible within the signed-in college community."
        right={
          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        }
      />
      <ProfileCard profile={account.data.profile} own />
    </>
  )
}

/** Another member's profile, opened from an author or mentor link. */
export function MemberProfile() {
  const actor = useOutletContext<ActorContextView>()
  const { memberId = '' } = useParams()
  const profile = useProfile(actor.accountId, memberId)
  if (profile.isPending) return <LoadingContent />
  if (profile.isError) return <ProfileError error={profile.error} onRetry={() => void profile.refetch()} />
  const own = profile.data.memberId === actor.accountId
  return (
    <>
      <ColumnHeader
        title={own ? 'My profile' : 'Member profile'}
        subtitle="Visible within the signed-in college community."
      />
      <ProfileCard profile={profile.data} own={own} />
      {(profile.data.role === 'STAFF' ||
        (profile.data.role === 'ALUMNI' && profile.data.alumniStatus === 'VERIFIED')) && (
        <MentorLink accountId={actor.accountId} memberId={profile.data.memberId} />
      )}
    </>
  )
}

/** A link to the member's mentorship page when they offer mentorship. */
function MentorLink({ accountId, memberId }: { accountId: string; memberId: string }) {
  const mentor = useMentorProfile(accountId, memberId)
  if (!mentor.data) return null
  return (
    <Card className="mt-3 flex items-center justify-between gap-4 p-4">
      <p className="text-[13.5px] text-slate-11">
        {mentor.data.viewerMentorship?.state === 'ACTIVE'
          ? 'Your mentor. Their contacts are on the mentor profile.'
          : mentor.data.viewerMentorship
            ? 'Your mentorship request to this mentor is pending.'
            : mentor.data.available
              ? 'Offers mentorship on the Mentorship Board.'
              : 'Mentor · not taking new requests.'}
      </p>
      <Link to={mentorPath(memberId)} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
        View mentorship
      </Link>
    </Card>
  )
}
