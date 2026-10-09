import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useGroups,
  usePeopleInGroup,
  useSearchPeople,
  useThread,
  useSendMessage,
  useUnreadChat,
  useMarkThreadRead,
} from '../hooks/useChat';
import useRowSelection from '../hooks/useRowSelection';
import useBulkActions, { bulkMessage, patchQueries } from '../hooks/useBulkActions';
import { apiService } from '../configs/api.config';
import Button from '../components/buttons/Button';
import PageHeader from '../components/layout/PageHeader';
import UnderlineTabs from '../components/layout/UnderlineTabs';
import BulkBar, { BulkAction } from '../components/layout/BulkBar';
import { EmptyState, ErrorState } from '../components/display/StateBlocks';
import { SearchIcon, SendIcon, ChevronIcon, MailOpenIcon, ChatIcon } from '../components/icons';
import { ListSkeleton, ChatSkeleton } from '../components/display/Skeleton';

// One key per thread: a person can be in two groups, and those are two chats.
const threadKey = (group, personId) => `${group}|${personId}`;

// The sidebar's NavBadge, same pill and colours, so an unread count looks
// the same in the nav and on the page it leads to.
function UnreadBadge({ count }) {
  if (!count) return null;
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-bold leading-none tabular-nums text-surface">
      {count > 9 ? '9+' : count}
    </span>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const Bubble = memo(function Bubble({ message }) {
  const failed = message.status === 'failed';
  return (
    <div className={`chat-bubble ${message.direction} ${failed ? 'failed' : ''}`}>
      {message.body}
      <span className="block mt-0.5 text-xs opacity-75">
        {formatTime(message.created_at)}
        {message.direction === 'outbound' && ` · ${failed ? 'failed to send' : message.status}`}
      </span>
    </div>
  );
});

// A row, not one big button: the tick needs its own click, and a checkbox
// inside a <button> is not something a browser will let you press.
function PersonListItem({ person, active, onSelect, groupLabel, unread, checked, onToggle }) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-border px-3 ${
        checked ? 'row-selected' : active ? 'bg-accent-tint' : 'bg-surface hover:bg-surface-sunken'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select the thread with ${person.person_name}`} />
      <button
        type="button"
        className="flex min-h-0 min-w-0 flex-1 items-center justify-between gap-2 border-0 bg-transparent px-0 py-2.5 text-left"
        onClick={onSelect}
      >
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="font-semibold text-sm">{person.person_name}</span>
          {groupLabel && <span className="text-xs text-text-muted truncate">{groupLabel}</span>}
        </span>
        <UnreadBadge count={unread} />
      </button>
    </div>
  );
}

function Thread({ group, person, onBack }) {
  const { data: messages, isLoading, error, refetch } = useThread(group, person.person_id);
  const { mutate: send, isPending } = useSendMessage();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function handleSubmit(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    send({ groupName: group, personId: person.person_id, body });
    setDraft('');
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border font-semibold text-sm">
        {/* The way back to the list on a phone, where the list is not on
            screen beside it. */}
        <Button size="icon" className="md:hidden shrink-0" onClick={onBack} aria-label="Back to everyone">
          <ChevronIcon width={16} height={16} className="rotate-180" />
        </Button>
        <span className="truncate">{person.person_name} · {group}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" ref={scrollRef}>
        {isLoading && <ChatSkeleton />}
        <ErrorState error={error} title="Couldn't load this conversation" onRetry={refetch} />
        {messages && messages.length === 0 && (
          <div className="p-8 text-center text-text-muted text-sm">No messages with {person.person_name} yet.</div>
        )}
        {messages?.map((m) => <Bubble key={m.id} message={m} />)}
      </div>

      <form className="flex gap-2 p-3 border-t border-border" onSubmit={handleSubmit}>
        <textarea
          className="flex-1 resize-none min-h-10 max-h-24"
          placeholder={`Message ${person.person_name}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <Button type="submit" variant="primary" size="form" disabled={isPending || !draft.trim()} aria-label="Send">
          <SendIcon width={16} height={16} />
          Send
        </Button>
      </form>
    </div>
  );
}

export default function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: groups } = useGroups();
  const { forGroup: chatCountForGroup, forPerson: chatCountForPerson } = useUnreadChat();
  const { mutate: markThreadRead } = useMarkThreadRead();
  const [activeGroup, setActiveGroup] = useState(searchParams.get('group'));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => {
    const group = searchParams.get('group');
    const personId = searchParams.get('personId');
    // name placeholder until the real roster loads and fills it in below —
    // the thread itself doesn't need a name to load, only the header does
    return group && personId ? { person_id: personId, person_name: personId, group } : null;
  });

  useEffect(() => {
    if (!activeGroup && groups?.length) setActiveGroup(groups[0]);
  }, [groups, activeGroup]);

  const {
    data: peopleInGroup, isLoading: loadingPeople, error: peopleError, refetch: refetchPeople,
  } = usePeopleInGroup(query ? undefined : activeGroup);
  const {
    data: searchResults, isLoading: loadingSearch, error: searchError, refetch: refetchSearch,
  } = useSearchPeople(query);

  // Fills in the real name once the roster loads, and marks the deep-linked
  // thread read the same way clicking it in the list would. Runs once the
  // matching person actually shows up — no assumption about load order.
  useEffect(() => {
    if (!selected || !peopleInGroup) return;
    const match = peopleInGroup.find((p) => p.person_id === selected.person_id);
    if (match && match.person_name !== selected.person_name) {
      setSelected((s) => (s ? { ...s, person_name: match.person_name } : s));
    }
  }, [peopleInGroup, selected]);

  useEffect(() => {
    if (!searchParams.get('personId')) return;
    const { group, person_id: personId } = selected ?? {};
    if (group && personId) markThreadRead({ group, personId });
    setSearchParams({}, { replace: true }); // one-shot — don't re-trigger on back/forward
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listing = query ? searchResults : peopleInGroup;
  const listingLoading = query ? loadingSearch : loadingPeople;
  const listingError = query ? searchError : peopleError;
  const groupOf = (p) => (query ? p.group_name : activeGroup);

  // The group selector is the page's tab row: one group's people at a
  // time. Searching spans every group, so no tab is on while it does.
  const groupTabs = useMemo(() => (groups ?? []).map((g) => ({
    key: g,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {g}
        <UnreadBadge count={chatCountForGroup(g)} />
      </span>
    ),
  })), [groups, chatCountForGroup]);

  const sel = useRowSelection((listing ?? []).map((p) => threadKey(groupOf(p), p.person_id)));
  const { run } = useBulkActions();

  // No bulk route: the same per-thread mark-read the list uses, in parallel.
  // The badges drop to zero at once (sidebar too, it reads the same cache).
  function markSelectedRead() {
    const keys = sel.ids;
    const threads = keys.map((k) => {
      const at = k.indexOf('|');
      return { group: k.slice(0, at), personId: k.slice(at + 1) };
    });
    const ticked = new Set(keys);
    run({
      call: () => Promise.all(threads.map((t) => apiService.messages.markRead(t.group, t.personId))),
      invalidates: [['unread-chat'], ['threads']],
      optimistic: (qc) => patchQueries(qc, [['unread-chat']], (data) => (
        Array.isArray(data?.unread)
          ? {
            ...data,
            unread: data.unread.map((r) => (
              r.unread && ticked.has(threadKey(r.group_name, r.person_id)) ? { ...r, unread: 0 } : r
            )),
          }
          : data
      )),
      icon: 'check',
      toast: bulkMessage('marked read', threads.length, 'thread'),
      failure: `Couldn't mark ${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} read`,
    });
    sel.clear();
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Chat" />

      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface h-[calc(100dvh-theme(spacing.header)-theme(spacing.bottomnav)-theme(spacing.safebottom)-2rem)] md:h-[calc(100vh-8rem)] min-h-96">
        <div className="overflow-x-auto px-2">
          <UnderlineTabs
            tabs={groupTabs}
            active={query ? null : activeGroup}
            onChange={(g) => { setQuery(''); setActiveGroup(g); }}
          />
        </div>

        <div className="flex flex-1 min-h-0">
          {/* A phone shows ONE pane: the list, or the thread you tapped.
              Side by side at 375px left the thread 119px wide. From md up
              they sit together as before. */}
          <div
            className={`w-full overflow-y-auto border-border md:block md:w-64 md:shrink-0 md:border-r ${
              selected ? 'hidden' : ''
            }`}
          >
            <div className="p-2 border-b border-border">
              <div className="relative">
                <input
                  type="search"
                  placeholder="Search everyone…"
                  className="w-full min-h-9 pl-8"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
              </div>
            </div>

            {listingLoading && <ListSkeleton />}
            <div className="px-2 pt-2 empty:hidden">
              <ErrorState error={listingError} title="Couldn't load people" onRetry={query ? refetchSearch : refetchPeople} />
            </div>
            {!listingLoading && !listingError && listing && listing.length === 0 && (
              <EmptyState icon={ChatIcon} title={query ? 'No one matches' : 'No one in this group'} />
            )}
            {listing?.map((p) => {
              const personGroup = groupOf(p);
              const key = threadKey(personGroup, p.person_id);
              const isActive = selected?.person_id === p.person_id && selected?.group === personGroup;
              return (
                <PersonListItem
                  key={`${personGroup}-${p.person_id}`}
                  person={p}
                  groupLabel={query ? p.group_name : null}
                  active={isActive}
                  unread={chatCountForPerson(personGroup, p.person_id)}
                  checked={sel.has(key)}
                  onToggle={() => sel.toggle(key)}
                  onSelect={() => {
                    setSelected({ person_id: p.person_id, person_name: p.person_name, group: personGroup });
                    markThreadRead({ group: personGroup, personId: p.person_id });
                  }}
                />
              );
            })}
          </div>

          {selected ? (
            <Thread group={selected.group} person={selected} onBack={() => setSelected(null)} />
          ) : (
            // Hidden on a phone: the list is already filling the screen, so
            // "select someone" would be a second panel telling you to do
            // what you are looking at.
            <div className="hidden flex-1 items-center justify-center p-4 text-center text-sm text-text-faint md:flex">
              Select someone to start a conversation.
            </div>
          )}
        </div>
      </div>

      <BulkBar count={sel.count} onClear={sel.clear}>
        <BulkAction icon={MailOpenIcon} onClick={markSelectedRead}>Mark read</BulkAction>
      </BulkBar>
    </div>
  );
}
