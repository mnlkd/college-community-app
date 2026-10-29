import { SEARCH_TEXT_MAX, normalizeTag, type ActorContextView } from '@hilcoe/shared'
import { Search as SearchIcon, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useSearch } from '../../api'
import { ErrorContent } from '../../design/states'
import { Badge, Button, ColumnHeader, Note } from '../../design/ui'
import { ACTIVITIES_PATH, MENTORSHIP_PATH, OPPORTUNITIES_PATH } from '../boards/content'
import { GroupCard } from '../groups/content'
import { MentorCard } from '../mentorship/content'
import { OpportunityCard } from '../opportunities/content'
import { Pager } from './content'
import { FeedLoading, PostList } from './Feeds'

export function Search() {
  const actor = useOutletContext<ActorContextView>()
  const [params, setParams] = useSearchParams()
  const text = params.get('text') ?? ''
  const tag = normalizeTag(params.get('tag') ?? '') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [typed, setTyped] = useState(text)
  const results = useSearch(actor.accountId, text, tag, page)

  function update(next: { text?: string; tag?: string; page?: number }) {
    const copy = new URLSearchParams()
    const nextText = (next.text ?? text).trim()
    const nextTag = next.tag ?? tag
    if (nextText) copy.set('text', nextText)
    if (nextTag) copy.set('tag', nextTag)
    if ((next.page ?? 1) > 1) copy.set('page', String(next.page))
    setParams(copy)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = typed.trim()
    // A lone #word searches by tag.
    const asTag = /^#\S+$/.test(value) ? normalizeTag(value) : null
    if (asTag) {
      setTyped('')
      update({ text: '', tag: asTag })
    } else update({ text: value })
  }

  const searched = text !== '' || tag !== ''
  const posts = results.data?.posts
  const mentors = results.data?.mentors
  const opportunities = results.data?.opportunities
  const groups = results.data?.groups
  const boardQuery = new URLSearchParams()
  if (text) boardQuery.set('text', text)
  if (tag) boardQuery.set('tag', tag)
  const postResults =
    !posts || posts.items.length === 0 ? (
      <Note>{page === 1 ? 'No posts match your search.' : 'No more results.'}</Note>
    ) : (
      <>
        <h2 className="font-display mb-3 font-bold">Posts</h2>
        <PostList posts={posts.items} actor={actor} />
        <Pager
          page={page}
          total={posts.total}
          pageSize={posts.pageSize}
          onPage={(next) => update({ page: next })}
          previous="Previous"
          next="More results"
        />
      </>
    )

  return (
    <>
      <ColumnHeader
        title="Search"
        subtitle="Find posts, opportunities, groups and mentors by keyword or tag."
      />
      <form role="search" onSubmit={submit} className="mb-4 flex gap-2">
        <label className="flex h-12 flex-1 items-center gap-3 rounded-xl border-2 border-slate-6 bg-white px-4 focus-within:border-iris-8">
          <SearchIcon className="size-5 text-slate-10" aria-hidden="true" />
          <span className="sr-only">Search text</span>
          <input
            type="search"
            value={typed}
            maxLength={SEARCH_TEXT_MAX}
            placeholder="Search posts, opportunities, groups and mentors, or #tag"
            className="h-full flex-1 bg-transparent text-[15px] outline-none! focus-visible:outline-none!"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <Button type="submit" size="lg">
          Search
        </Button>
      </form>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tag && (
          <Badge tone="iris">
            #{tag}
            <button type="button" aria-label={`Remove tag filter ${tag}`} onClick={() => update({ tag: '' })}>
              <X className="size-3" />
            </button>
          </Badge>
        )}
        <Badge>Relevance, then newest</Badge>
      </div>
      {!searched ? (
        <Note>Enter a search term or choose a tag.</Note>
      ) : results.isPending ? (
        <FeedLoading />
      ) : results.isError ? (
        <ErrorContent message={results.error.message} onRetry={() => void results.refetch()} />
      ) : (
        <>
          {page === 1 && opportunities && (
            <BoardResults
              title="Opportunities"
              total={opportunities.total}
              more={`${OPPORTUNITIES_PATH}?${boardQuery.toString()}`}
              noun="listings"
            >
              {opportunities.items.slice(0, 3).map((opportunity) => (
                <OpportunityCard key={opportunity.id} opportunity={opportunity} actor={actor} />
              ))}
            </BoardResults>
          )}
          {page === 1 && groups && (
            <BoardResults
              title="Groups"
              total={groups.total}
              more={`${ACTIVITIES_PATH}?${boardQuery.toString()}`}
              noun="groups"
            >
              {groups.items.slice(0, 3).map((group) => (
                <GroupCard key={group.id} group={group} actor={actor} />
              ))}
            </BoardResults>
          )}
          {page === 1 && mentors && (
            <BoardResults
              title="Mentors"
              total={mentors.total}
              more={`${MENTORSHIP_PATH}?${boardQuery.toString()}`}
              noun="mentors"
            >
              {mentors.items.slice(0, 3).map((mentor) => (
                <MentorCard key={mentor.mentor.memberId} mentor={mentor} />
              ))}
            </BoardResults>
          )}
          {postResults}
        </>
      )}
    </>
  )
}

/** The first three board results of a category, with a link to the board for the rest. */
function BoardResults({
  title,
  total,
  more,
  noun,
  children,
}: {
  title: string
  total: number
  more: string
  noun: string
  children: ReactNode
}) {
  if (total === 0) return null
  return (
    <section aria-label={title} className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display font-bold">{title}</h2>
        {total > 3 && (
          <Link to={more} className="text-[13px] font-semibold text-iris-11 hover:underline">
            All {total} {noun}
          </Link>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
