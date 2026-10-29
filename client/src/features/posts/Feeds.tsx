import { TRENDING_DAYS, type ActorContextView, type PostSummaryView } from '@hilcoe/shared'
import { Image, Tag } from 'lucide-react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useHomeFeed, useOwnAccount, useSavedItems, useToggleSave, useTrendingPosts } from '../../api'
import { ErrorContent } from '../../design/states'
import { Avatar, Badge, Button, Card, ColumnHeader, Note, Shimmer, buttonClass, cx } from '../../design/ui'
import { GroupCard } from '../groups/content'
import { OpportunityCard } from '../opportunities/content'
import { ArchivedNote, Pager, PostCard } from './content'
import { canInteract, publishBlockReason } from './eligibility'
import { ModerationBanners } from '../moderation/Standing'

/** The current page from `?page=`, at least 1. */
export function usePageParam(): [number, (page: number) => void] {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const setPage = (next: number) => {
    const copy = new URLSearchParams(params)
    if (next <= 1) copy.delete('page')
    else copy.set('page', String(next))
    setParams(copy)
    window.scrollTo?.({ top: 0 })
  }
  return [page, setPage]
}

function Composer({ actor }: { actor: ActorContextView }) {
  const blocked = publishBlockReason(actor)
  const own = useOwnAccount(actor.accountId)
  const name = own.data?.displayName ?? 'You'
  return (
    <Card className="mb-5 px-5 py-4">
      <div className="flex gap-3">
        <Avatar name={name} size={40} src={own.data?.profile.pictureUrl ?? undefined} />
        <div className="min-w-0 flex-1">
          {blocked ? (
            <p className="pt-2 text-[14px] text-slate-10">{blocked}</p>
          ) : (
            <Link to="/posts/new" className="block pt-2 text-[15px] text-slate-9">
              Share an update, a question, or something useful…
            </Link>
          )}
          <div className="mt-3 flex items-center gap-3 border-t border-slate-4 pt-3">
            <Image className="size-4 text-iris-11" aria-hidden="true" />
            <Tag className="size-4 text-iris-11" aria-hidden="true" />
            <span className="text-[12px] text-slate-9">Community post · optional images and tags</span>
            {!blocked && (
              <Link to="/posts/new" className={cx(buttonClass({ size: 'sm' }), 'ml-auto')}>
                Write a post
              </Link>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function FeedLinks({ active }: { active: 'latest' | 'trending' | 'saved' }) {
  const links = [
    { key: 'latest', to: '/home', label: 'Latest posts' },
    { key: 'trending', to: '/home/trending', label: 'Trending posts' },
    { key: 'saved', to: '/saved', label: 'My saved items' },
  ] as const
  return (
    <nav
      aria-label="Feeds"
      className="mb-4 flex gap-6 border-b border-slate-5 pb-3 text-[14px] font-semibold"
    >
      {links.map((link) => (
        <Link
          key={link.key}
          to={link.to}
          aria-current={active === link.key ? 'page' : undefined}
          className={active === link.key ? 'text-iris-11' : 'text-slate-10 hover:text-slate-12'}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}

export function FeedLoading() {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading posts">
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
  )
}

export function PostList({ posts, actor }: { posts: PostSummaryView[]; actor: ActorContextView }) {
  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} actor={actor} />
      ))}
    </div>
  )
}

/** Member home: the composer and the newest visible posts. */
export function Home() {
  const actor = useOutletContext<ActorContextView>()
  const [page, setPage] = usePageParam()
  const feed = useHomeFeed(actor.accountId, page)
  return (
    <>
      <ColumnHeader title="Home" subtitle="The latest from your college community." />
      <ModerationBanners actor={actor} />
      <Composer actor={actor} />
      <FeedLinks active="latest" />
      {feed.isPending ? (
        <FeedLoading />
      ) : feed.isError ? (
        <ErrorContent message={feed.error.message} onRetry={() => void feed.refetch()} />
      ) : feed.data.items.length === 0 ? (
        <Note>{page === 1 ? 'No posts yet. Be the first to share something.' : 'No more posts.'}</Note>
      ) : (
        <>
          <PostList posts={feed.data.items} actor={actor} />
          <Pager page={page} total={feed.data.total} pageSize={feed.data.pageSize} onPage={setPage} />
        </>
      )}
    </>
  )
}

export function Trending() {
  const actor = useOutletContext<ActorContextView>()
  const trending = useTrendingPosts(actor.accountId, 20)
  return (
    <>
      <ColumnHeader
        title="Trending posts"
        subtitle={`Recent community discussions · last ${TRENDING_DAYS} days.`}
      />
      <FeedLinks active="trending" />
      {trending.isPending ? (
        <FeedLoading />
      ) : trending.isError ? (
        <ErrorContent message={trending.error.message} onRetry={() => void trending.refetch()} />
      ) : trending.data.length === 0 ? (
        <Note>No posts from the last {TRENDING_DAYS} days yet.</Note>
      ) : (
        <PostList posts={trending.data} actor={actor} />
      )}
      <p className="mt-4 text-[12px] text-slate-10">
        Ranking uses likes, distinct commenters, counted views and age, not saves.
      </p>
    </>
  )
}

export function SavedItems() {
  const actor = useOutletContext<ActorContextView>()
  const [page, setPage] = usePageParam()
  const saved = useSavedItems(actor.accountId, page)
  const unsave = useToggleSave(actor.accountId)
  return (
    <>
      <ColumnHeader
        title="Saved items"
        subtitle="Your private bookmarks. Other members cannot see who saved an item."
      />
      <FeedLinks active="saved" />
      {!canInteract(actor) && (
        <div className="mb-4">
          <Note tone="amber">
            You may view or remove previous bookmarks, but cannot add new saves while your account is
            restricted.
          </Note>
        </div>
      )}
      {unsave.isError && (
        <div className="mb-4">
          <Note tone="red">{unsave.error.message}</Note>
        </div>
      )}
      {saved.isPending ? (
        <FeedLoading />
      ) : saved.isError ? (
        <ErrorContent message={saved.error.message} onRetry={() => void saved.refetch()} />
      ) : saved.data.items.length === 0 ? (
        <Note>{page === 1 ? 'You have no saved items.' : 'No more saved items.'}</Note>
      ) : (
        <>
          <div className="space-y-4">
            {saved.data.items.map((item) => (
              <section key={item.id} aria-label="Saved item">
                {item.post ? (
                  <PostCard post={item.post} actor={actor} />
                ) : item.opportunity ? (
                  <OpportunityCard opportunity={item.opportunity} actor={actor} />
                ) : item.group ? (
                  <GroupCard group={item.group} actor={actor} />
                ) : (
                  <Card className="px-5 py-4">
                    <Badge tone="red">Unavailable</Badge>
                    <p className="mt-2 text-[14px] text-slate-10">This item is no longer available.</p>
                  </Card>
                )}
                {item.post?.state === 'ARCHIVED' && (
                  <div className="mt-2">
                    <ArchivedNote />
                  </div>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1"
                  disabled={unsave.isPending}
                  onClick={() => unsave.mutate({ type: item.targetType, id: item.targetId, save: false })}
                >
                  Remove saved item
                </Button>
              </section>
            ))}
          </div>
          <Pager page={page} total={saved.data.total} pageSize={saved.data.pageSize} onPage={setPage} />
        </>
      )}
    </>
  )
}
