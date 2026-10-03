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
import { SearchIcon, SendIcon, ChevronIcon } from '../components/icons';
import { ListSkeleton, ChatSkeleton } from '../components/display/Skeleton';

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const Bubble = memo(function Bubble({ message }) {
  const failed = message.status === 'failed';
  return (
    <div className={`chat-bubble ${message.direction} ${failed ? 'failed' : ''}`}>
      {message.body}
      <span className="block mt-0.5 text-[0.6875rem] opacity-75">
        {formatTime(message.created_at)}
        {message.direction === 'outbound' && ` · ${failed ? 'failed to send' : message.status}`}
      </span>
    </div>
  );
});

function PersonListItem({ person, active, onSelect, groupLabel, unread }) {
  return (
    <button
      type="button"
      className={`flex items-center justify-between gap-2 w-full text-left border-0 border-b border-border min-h-0 px-3 py-2.5 ${
        active ? 'bg-accent-tint' : 'bg-surface hover:bg-surface-sunken'
      }`}
      onClick={onSelect}
    >
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="font-semibold text-sm">{person.person_name}</span>
        {groupLabel && <span className="text-xs text-text-muted truncate">{groupLabel}</span>}
      </span>
      {unread > 0 && (
        <span className="shrink-0 min-w-4 h-4 px-1 bg-danger text-white text-[0.625rem] font-bold flex items-center justify-center leading-none">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

function Thread({ group, person, onBack }) {
  const { data: messages, isLoading } = useThread(group, person.person_id);
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
        <button
          type="button"
          className="md:hidden min-h-0 shrink-0 border-0 bg-transparent p-0 text-text-muted"
          onClick={onBack}
          aria-label="Back to everyone"
        >
          <ChevronIcon width={18} height={18} className="rotate-180" />
        </button>
        <span className="truncate">{person.person_name} · {group}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" ref={scrollRef}>
        {isLoading && <ChatSkeleton />}
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
        <button type="submit" className="btn-primary" disabled={isPending || !draft.trim()} aria-label="Send">
          <SendIcon />
        </button>
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

  const { data: peopleInGroup, isLoading: loadingPeople } = usePeopleInGroup(query ? undefined : activeGroup);
  const { data: searchResults, isLoading: loadingSearch } = useSearchPeople(query);

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

  const groupTabs = useMemo(() => groups ?? [], [groups]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="text-lg font-bold tracking-tight sm:text-xl">Chat</h1>
      </div>

      <div className="flex flex-col border border-border bg-surface h-[calc(100dvh-theme(spacing.header)-theme(spacing.bottomnav)-theme(spacing.safebottom)-2rem)] md:h-[calc(100vh-8rem)] min-h-96">
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-surface-sunken p-1">
          {groupTabs.map((g) => {
            const isActive = !query && activeGroup === g;
            const unread = chatCountForGroup(g);
            return (
              <button
                key={g}
                type="button"
                className={`flex items-center gap-1.5 rounded-md border-0 min-h-0 px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-accent-tint-strong text-accent-strong'
                    : 'bg-transparent text-text-muted hover:bg-surface hover:text-text'
                }`}
                onClick={() => {
                  setQuery('');
                  setActiveGroup(g);
                }}
              >
                {g}
                {unread > 0 && (
                  <span className="min-w-4 h-4 px-1 bg-danger text-white text-[0.625rem] font-bold flex items-center justify-center leading-none">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            );
          })}
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
            {!listingLoading && listing && listing.length === 0 && (
              <div className="p-8 text-center text-text-muted text-sm">
                {query ? 'No one matches.' : 'No one in this group.'}
              </div>
            )}
            {listing?.map((p) => {
              const personGroup = query ? p.group_name : activeGroup;
              const isActive = selected?.person_id === p.person_id && selected?.group === personGroup;
              return (
                <PersonListItem
                  key={`${personGroup}-${p.person_id}`}
                  person={p}
                  groupLabel={query ? p.group_name : null}
                  active={isActive}
                  unread={chatCountForPerson(personGroup, p.person_id)}
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
    </div>
  );
}
