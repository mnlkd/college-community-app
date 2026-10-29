import { Search } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTrendingPosts } from '../../api'
import { timeAgo } from '../notifications/Notifications'

export function MemberRail({ accountId }: { accountId: string | null }) {
  const onSearch = useLocation().pathname === '/search'
  return (
    <>
      {!onSearch && (
        <Link
          to="/search"
          className="flex h-10 items-center gap-2.5 rounded-lg border border-slate-6 bg-white px-3.5 transition-colors duration-150 hover:border-iris-8"
        >
          <Search className="size-4 text-slate-9" strokeWidth={2} />
          <span className="text-[13.5px] text-slate-9">Search</span>
        </Link>
      )}
      {accountId && <TrendingCard accountId={accountId} />}
    </>
  )
}

function TrendingCard({ accountId }: { accountId: string }) {
  const trending = useTrendingPosts(accountId)
  const posts = trending.data ?? []
  return (
    <section
      aria-label="Trending posts"
      className="overflow-hidden rounded-xl border border-iris-6 bg-iris-3"
    >
      <h3 className="font-display px-4 pt-3.5 pb-1 text-[14.5px] font-bold tracking-[-0.022em] text-slate-12">
        Trending posts
      </h3>
      {trending.isPending ? (
        <p className="px-4 py-2.5 text-[12.5px] text-slate-10">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="px-4 py-2.5 text-[12.5px] text-slate-10">No recent discussions yet.</p>
      ) : (
        posts.map((post) => (
          <Link
            key={post.id}
            to={`/posts/${post.id}`}
            className="block px-4 py-2.5 transition-colors duration-150 hover:bg-iris-4"
          >
            <p className="text-[11px] text-slate-9">
              {post.author.displayName} · {timeAgo(post.createdAt)}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug font-medium tracking-[-0.01em] text-slate-12">
              {post.body ?? (post.images.length > 0 ? 'Image post' : '')}
            </p>
          </Link>
        ))
      )}
      <Link
        to="/home/trending"
        className="font-display block border-t border-iris-6 px-4 py-2.5 text-[12.5px] font-semibold text-iris-11 transition-colors duration-150 hover:bg-iris-4"
      >
        View trending posts
      </Link>
    </section>
  )
}
