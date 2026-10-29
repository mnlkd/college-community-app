import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminSettings } from '../admin/AdminSettings'
import { Administrators, CreateAdministrator } from '../admin/Administrators'
import { Dashboard } from '../admin/Dashboard'
import { ManageUser } from '../admin/ManageUser'
import { StaffEmails } from '../admin/StaffEmails'
import { AdminUsers } from '../admin/Users'
import {
  AcceptInvite,
  AccountDisabled,
  AdminSignIn,
  MemberSignIn,
  Recover,
  RegisterAlumni,
  RegisterInstitutional,
  RegisterRole,
  VerifyEmail,
} from '../auth'
import { AdminAudit } from '../admin/AuditLog'
import { AdminModeration, AdminReportDecision } from '../admin/Moderation'
import { MentorAvailability } from '../features/mentorship/Availability'
import { ActivitiesBoard, GroupDetail, ManageGroup, NewGroup } from '../features/groups/Groups'
import {
  EditOpportunity,
  NewOpportunity,
  OpportunitiesBoard,
  OpportunityDetail,
} from '../features/opportunities/Opportunities'
import { MentorProfilePage, MentorshipBoard, RequestMentorship } from '../features/mentorship/Board'
import { MyRequests, OpenMentorship } from '../features/mentorship/MyRequests'
import { ReportContent, ReportHistory } from '../features/moderation/Reports'
import { Notifications } from '../features/notifications/Notifications'
import { Home, SavedItems, Trending } from '../features/posts/Feeds'
import { PostDetail } from '../features/posts/PostDetail'
import { DeletePost, EditPost, NewPost } from '../features/posts/PostEditor'
import { Search } from '../features/posts/Search'
import { EditProfile } from '../features/profile/EditProfile'
import { MemberProfile, MyProfile } from '../features/profile/Profile'
import { CompleteProfile } from '../features/registration/CompleteProfile'
import { ChangeEmail } from '../features/settings/ChangeEmail'
import { ChangePassword, PasswordChanged } from '../features/settings/ChangePassword'
import { DeleteAccount } from '../features/settings/DeleteAccount'
import { GraduationRequest } from '../features/settings/GraduationRequest'
import { Settings } from '../features/settings/Settings'
import { RequireAdmin, RequireMember } from './guards'
import { NotFound } from './NotFound'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/login" element={<MemberSignIn />} />
      <Route path="/admin/login" element={<AdminSignIn />} />
      <Route path="/admin/invite" element={<AcceptInvite />} />
      <Route path="/register" element={<RegisterRole />} />
      <Route path="/register/student" element={<RegisterInstitutional />} />
      <Route path="/register/alumni" element={<RegisterAlumni />} />
      <Route path="/register/verify" element={<VerifyEmail />} />
      <Route path="/register/profile" element={<CompleteProfile />} />
      <Route path="/recover" element={<Recover />} />
      <Route path="/account-disabled" element={<AccountDisabled />} />
      <Route element={<RequireMember />}>
        <Route path="/home" element={<Home />} />
        <Route path="/home/trending" element={<Trending />} />
        <Route path="/posts/new" element={<NewPost />} />
        <Route path="/posts/:postId" element={<PostDetail />} />
        <Route path="/posts/:postId/edit" element={<EditPost />} />
        <Route path="/posts/:postId/delete" element={<DeletePost />} />
        <Route path="/search" element={<Search />} />
        <Route path="/saved" element={<SavedItems />} />
        <Route path="/boards" element={<Navigate to="/boards/opportunities" replace />} />
        <Route path="/boards/opportunities" element={<OpportunitiesBoard />} />
        <Route path="/boards/opportunities/new" element={<NewOpportunity />} />
        <Route path="/boards/opportunities/listings/:opportunityId" element={<OpportunityDetail />} />
        <Route path="/boards/opportunities/listings/:opportunityId/edit" element={<EditOpportunity />} />
        <Route path="/boards/activities" element={<ActivitiesBoard />} />
        <Route path="/boards/activities/new" element={<NewGroup />} />
        <Route path="/boards/activities/groups/:groupId" element={<GroupDetail />} />
        <Route path="/boards/activities/groups/:groupId/manage" element={<ManageGroup />} />
        <Route path="/boards/mentorship" element={<MentorshipBoard />} />
        <Route path="/boards/mentorship/mentors/:mentorId" element={<MentorProfilePage />} />
        <Route path="/boards/mentorship/mentors/:mentorId/request" element={<RequestMentorship />} />
        <Route path="/boards/mentorship/my-requests" element={<MyRequests />} />
        <Route path="/boards/mentorship/requests/:mentorshipId" element={<OpenMentorship />} />
        <Route path="/boards/mentorship/availability" element={<MentorAvailability />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<ReportHistory />} />
        <Route path="/reports/new" element={<ReportContent />} />
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/profile/edit" element={<EditProfile />} />
        <Route path="/members/:memberId" element={<MemberProfile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/password" element={<ChangePassword />} />
        <Route path="/settings/password/done" element={<PasswordChanged />} />
        <Route path="/settings/email" element={<ChangeEmail />} />
        <Route path="/settings/graduation" element={<GraduationRequest />} />
        <Route path="/settings/delete" element={<DeleteAccount />} />
      </Route>
      <Route element={<RequireAdmin />}>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/users/:memberId" element={<ManageUser />} />
        <Route path="/admin/moderation" element={<AdminModeration />} />
        <Route path="/admin/moderation/:reportId" element={<AdminReportDecision />} />
        <Route path="/admin/audit" element={<AdminAudit />} />
        <Route path="/admin/staff-emails" element={<StaffEmails />} />
        <Route path="/admin/administrators" element={<Administrators />} />
        <Route path="/admin/administrators/new" element={<CreateAdministrator />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
