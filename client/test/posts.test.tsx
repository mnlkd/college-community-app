import type {
  ActorContextView,
  CommentView,
  MemberCardView,
  NotificationView,
  Page,
  PostView,
} from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPostForm, configureApi, createQueryClient } from '../src/api'
import { RoleMark } from '../src/design/content'
import { Notifications } from '../src/features/notifications/Notifications'
import { LinkedText } from '../src/features/posts/content'
import { canInteract, canPublish, publishBlockReason } from '../src/features/posts/eligibility'
import { Home } from '../src/features/posts/Feeds'
import { PostDetail } from '../src/features/posts/PostDetail'
import { NewPost, draftProblems } from '../src/features/posts/PostEditor'

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => {
    throw new Error('Supabase is not used in these tests')
  },
}))

const student: ActorContextView = {
  accountId: '00000000-0000-4000-8000-000000000001',
  kind: 'MEMBER',
  role: 'STUDENT',
  alumniStatus: null,
  accountState: 'ACTIVE',
  restrictedUntil: null,
  mfaVerified: false,
  isFirstAdmin: false,
}

const author: MemberCardView = {
  memberId: '00000000-0000-4000-8000-000000000002',
  displayName: 'Yonas Bekele',
  role: 'ALUMNI',
  alumniStatus: 'VERIFIED',
  pictureUrl: null,
  deleted: false,
}

function post(overrides: Partial<PostView> = {}): PostView {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    author,
    body: 'Internship tips: see https://example.com/tips.',
    images: [],
    tags: ['career'],
    state: 'VISIBLE',
    version: 1,
    likeCount: 2,
    commentCount: 0,
    viewCount: 7,
    saveCount: 1,
    likedByMe: false,
    savedByMe: false,
    isOwn: false,
    createdAt: new Date().toISOString(),
    editedAt: null,
    ...overrides,
  }
}

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 20, total: items.length })

function Where() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname}</p>
}

function inShell(element: ReactNode, path: string, pattern: string, actor = student) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={actor} />}>
            <Route path={pattern} element={element} />
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

type Handler = (url: URL, init: RequestInit) => [number, unknown]

function serve(handler: Handler) {
  const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
    const [status, body] = handler(url, init)
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const calls = (fetchMock: ReturnType<typeof serve>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init.method ?? 'GET'} ${url.pathname}`)

beforeEach(() => {
  vi.unstubAllGlobals()
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
})

describe('buildPostForm', () => {
  it('sends the post JSON with image slots in order, then only the new files', async () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const form = buildPostForm(
      {
        body: 'Hello',
        tags: ['career'],
        images: [
          { kind: 'existing', imageId: 'img-1', url: 'u', altText: 'Old' },
          { kind: 'new', file, previewUrl: 'blob:1', altText: '' },
        ],
      },
      3,
    )
    expect(JSON.parse(form.get('post') as string)).toEqual({
      body: 'Hello',
      tags: ['career'],
      images: [
        { imageId: 'img-1', altText: 'Old' },
        { imageId: null, altText: '' },
      ],
      version: 3,
    })
    const images = form.getAll('images') as File[]
    expect(images).toHaveLength(1)
    expect(images[0]?.name).toBe('photo.png')
  })

  it('reports an empty post and an over-long body before sending', () => {
    expect(draftProblems({ body: '  ', tags: [], images: [] })).toEqual({
      body: 'Write something or add an image',
    })
    expect(draftProblems({ body: 'x'.repeat(10_001), tags: [], images: [] }).body).toMatch(/At most/)
  })
})

describe('eligibility', () => {
  it('lets Self-Reported Alumni browse but not publish or interact; a restriction blocks only publishing', () => {
    const selfReported = { ...student, role: 'ALUMNI' as const, alumniStatus: 'SELF_REPORTED' as const }
    expect(canInteract(selfReported)).toBe(false)
    expect(publishBlockReason(selfReported)).toMatch(/verified/)
    const restricted = { ...student, restrictedUntil: new Date(Date.now() + 3_600_000).toISOString() }
    expect(canInteract(restricted)).toBe(true)
    expect(canPublish(restricted)).toBe(false)
    expect(publishBlockReason(restricted)).toMatch(/restricted until/)
  })
})

describe('RoleMark', () => {
  it('names the role for hover and screen readers, and withholds the check from unverified Alumni', () => {
    render(
      <>
        <RoleMark role="STUDENT" alumniStatus={null} />
        <RoleMark role="STAFF" alumniStatus={null} />
        <RoleMark role="ALUMNI" alumniStatus="VERIFIED" />
        <RoleMark role="ALUMNI" alumniStatus="SELF_REPORTED" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'Student' })).toHaveAttribute('title', 'Student')
    expect(screen.getByRole('img', { name: 'Staff' })).toHaveClass('text-blue-11')
    expect(screen.getByRole('img', { name: 'Verified Alumni' })).toHaveClass('text-amber-11')
    const unverified = screen.getByRole('img', { name: 'Alumni · Self-Reported' })
    expect(unverified).toHaveClass('text-slate-9')
    expect(unverified.querySelector('svg')).not.toHaveClass('lucide-badge-check')
    expect(screen.getByRole('img', { name: 'Student' }).querySelector('svg')).toHaveClass(
      'lucide-badge-check',
    )
  })
})

describe('LinkedText', () => {
  it('turns web addresses into links and leaves trailing punctuation outside', () => {
    render(<LinkedText text="Read https://example.com/a. Then reply." />)
    expect(screen.getByRole('link', { name: 'https://example.com/a' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    )
  })
})

describe('Home feed', () => {
  it('lists posts and likes one, then shows the refreshed count', async () => {
    let liked = false
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/posts' && init.method === 'GET') {
        return [200, page([post({ likedByMe: liked, likeCount: liked ? 3 : 2 })])]
      }
      if (url.pathname.endsWith('/likes') && init.method === 'PUT') {
        liked = true
        return [200, { liked: true, likeCount: 3 }]
      }
      if (url.pathname === '/api/members/me') return [200, { displayName: 'Selam', profile: {} }]
      return [404, null]
    })
    inShell(<Home />, '/home', '/home')
    const card = await screen.findByRole('article', { name: 'Post by Yonas Bekele' })
    expect(within(card).getByRole('link', { name: '#career' })).toHaveAttribute('href', '/search?tag=career')
    await userEvent.click(within(card).getByRole('button', { name: 'Like post' }))
    await waitFor(() => expect(within(card).getByTestId('like-count')).toHaveTextContent('3'))
    expect(within(card).getByRole('button', { name: 'Unlike post' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls(fetchMock)).toContain(`PUT /api/posts/${post().id}/likes`)
  })

  it('tells a Self-Reported Alumnus why the composer is unavailable', async () => {
    serve((url) => (url.pathname === '/api/posts' ? [200, page([])] : [404, null]))
    inShell(<Home />, '/home', '/home', { ...student, role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    expect(await screen.findByText(/once your Alumni status is verified/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Write a post' })).not.toBeInTheDocument()
  })
})

describe('New post', () => {
  it('normalizes tags and publishes a multipart post, then opens it', async () => {
    let sent: FormData | null = null
    serve((url, init) => {
      if (url.pathname === '/api/posts' && init.method === 'POST') {
        sent = init.body as FormData
        return [201, post({ id: '00000000-0000-4000-8000-0000000000b2', isOwn: true })]
      }
      return [404, null]
    })
    inShell(<NewPost />, '/posts/new', '/posts/new')
    await userEvent.type(screen.getByLabelText(/^Post/), '  Looking for a study partner  ')
    await userEvent.type(
      screen.getByRole('textbox', { name: /^Tags/ }),
      '#Study-Group{Enter}#study-group{Enter}',
    )
    expect(within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem')).toHaveLength(1)
    await userEvent.type(screen.getByRole('textbox', { name: /^Tags/ }), 'bad tag!{Enter}')
    expect(screen.getByText('Use 1 to 30 letters, digits, hyphens or underscores.')).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: /^Tags/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/posts/'))
    expect(JSON.parse(sent!.get('post') as string)).toMatchObject({
      body: '  Looking for a study partner  ',
      tags: ['study-group'],
      images: [],
    })
  })

  it('refuses a file that is not a JPEG, PNG or WebP image', async () => {
    serve(() => [404, null])
    inShell(<NewPost />, '/posts/new', '/posts/new')
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' })
    await userEvent.upload(screen.getByTestId('post-image-input'), gif, { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a JPEG, PNG or WebP image no larger than 5 MB.',
    )
  })
})

describe('Post detail', () => {
  const comment = (overrides: Partial<CommentView> = {}): CommentView => ({
    id: '00000000-0000-4000-8000-0000000000c1',
    postId: post().id,
    parentCommentId: null,
    author: { ...author, displayName: 'Abel Tadesse', role: 'STUDENT', alumniStatus: null },
    body: 'Great tips',
    state: 'VISIBLE',
    version: 1,
    likeCount: 0,
    likedByMe: false,
    isOwn: false,
    createdAt: new Date().toISOString(),
    editedAt: null,
    replies: [],
    ...overrides,
  })

  it('records one view, shows comments with replies, and posts a reply to a comment', async () => {
    let replyBody: unknown = null
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/posts/${post().id}` && init.method === 'GET')
        return [200, post({ commentCount: 2 })]
      if (url.pathname.endsWith('/views')) return [204, null]
      if (url.pathname.endsWith('/comments') && init.method === 'GET') {
        const reply = comment({ id: 'r1', parentCommentId: 'c', body: 'Agreed', replies: [] })
        return [200, page([comment({ replies: [reply] })])]
      }
      if (url.pathname.endsWith('/comments') && init.method === 'POST') {
        replyBody = JSON.parse(init.body as string)
        return [201, comment({ id: 'r2' })]
      }
      return [404, null]
    })
    inShell(<PostDetail />, `/posts/${post().id}`, '/posts/:postId')
    expect(await screen.findByText('Great tips')).toBeInTheDocument()
    expect(screen.getByText('Agreed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://example.com/tips' })).toBeInTheDocument()
    expect(screen.getByText('7 views')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]!)
    const box = screen.getByLabelText('Reply to Abel Tadesse')
    await userEvent.type(box, 'Thanks!')
    await userEvent.click(within(box.closest('form')!).getByRole('button', { name: 'Reply' }))
    await waitFor(() =>
      expect(replyBody).toEqual({ body: 'Thanks!', parentCommentId: '00000000-0000-4000-8000-0000000000c1' }),
    )
    expect(calls(fetchMock).filter((call) => call.endsWith('/views'))).toHaveLength(1)
  })

  it('shows an archived post read-only: no comment box, and only own comments can be deleted', async () => {
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/posts/${post().id}` && init.method === 'GET') {
        return [200, post({ state: 'ARCHIVED', body: null, editedAt: null })]
      }
      if (url.pathname.endsWith('/comments')) return [200, page([comment({ isOwn: true })])]
      return [404, null]
    })
    inShell(<PostDetail />, `/posts/${post().id}`, '/posts/:postId')
    expect(await screen.findByRole('heading', { name: 'Archived discussion' })).toBeInTheDocument()
    await screen.findByText('Great tips')
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save post' })).toBeDisabled()
    expect(calls(fetchMock).some((call) => call.endsWith('/views'))).toBe(false)
  })

  it('reports a post the member may not see as unavailable', async () => {
    serve(() => [404, { error: { code: 'NOT_FOUND', message: 'Not found', fields: null } }])
    inShell(<PostDetail />, `/posts/${post().id}`, '/posts/:postId')
    expect(
      await screen.findByText('This post does not exist or is not available to you.'),
    ).toBeInTheDocument()
  })
})

describe('Notifications', () => {
  it('opens the post a comment notice points at', async () => {
    const notice: NotificationView = {
      id: 'n1',
      type: 'COMMENT',
      actorId: author.memberId,
      actorName: 'Abel Tadesse',
      targetType: 'COMMENT',
      targetId: 'c1',
      unread: false,
      createdAt: new Date().toISOString(),
    }
    serve((url) => {
      if (url.pathname === '/api/notifications') return [200, page([notice])]
      if (url.pathname === '/api/notifications/unread-count') return [200, { count: 0 }]
      if (url.pathname === '/api/comments/c1') return [200, { postId: 'p9' }]
      return [404, null]
    })
    inShell(<Notifications />, '/notifications', '/notifications')
    await userEvent.click(await screen.findByRole('button', { name: 'Open notification from Abel Tadesse' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/posts/p9'))
  })
})
