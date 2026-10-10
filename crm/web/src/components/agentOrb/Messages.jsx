/**
 * The message bubbles, rendered identically in two places: the short strip
 * under the orb, and the expanded right-hand drawer.
 *
 * Pulled out purely so those two can never drift apart. They're the same
 * conversation, so a change to how a bubble looks has to land in both, and
 * the reliable way to guarantee that is for there to be only one of them.
 * The two callers own their own scroll container and sizing; this owns
 * nothing but the bubbles.
 */
import { useState } from 'react';
import DealForm from './forms/DealForm';
import DealCard from './forms/DealCard';
import DealList from './forms/DealList';
import RecentChangesList from './forms/RecentChangesList';
import CompanyList from './forms/CompanyList';
import SectionedList from './forms/SectionedList';
import TurnOffer from './TurnOffer';
import SheetCheck from './forms/SheetCheck';
import ExpenseImage from './forms/ExpenseImage';
import { SpinnerIcon } from '../icons';

/**
 * SHE IS STILL GOING, and it MOVES.
 *
 * A bulk write is several seconds, and a line of static text is what a
 * frozen screen looks like too. One turning mark answers "is this alive"
 * without another sentence. `motion-reduce` stops it turning and leaves the
 * mark, so the answer survives a reduced motion setting.
 */
function Working({ children }) {
  return (
    <span className="flex items-center gap-2">
      <SpinnerIcon
        width={12}
        height={12}
        className="shrink-0 animate-spin text-diane-signal motion-reduce:animate-none"
      />
      {children}
    </span>
  );
}

/**
 * `#47` IN HER PROSE OPENS THE ROW.
 *
 * She already puts ids in her answers on purpose, so the next turn can say
 * "change the preset on that one" without her searching again. They were
 * plain text, so the only way to see the row was to ask her for it.
 *
 * Assistant text only. A row id the ADMIN typed is a question, not a
 * reference to something already on screen.
 */
const ROW_ID = /#(\d{1,6})\b/g;

function linkify(text, onOpenDeal) {
  if (!onOpenDeal) return text;
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(ROW_ID)) {
    if (m.index > last) out.push(String(text).slice(last, m.index));
    out.push(
      <button
        key={`${m.index}-${m[1]}`}
        type="button"
        onClick={() => onOpenDeal({ id: Number(m[1]) })}
        className="min-h-0 border-0 bg-transparent p-0 font-semibold text-diane-signal underline decoration-diane-line hover:decoration-diane-signal"
      >
        {m[0]}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last === 0) return text;
  out.push(String(text).slice(last));
  return out;
}

/**
 * ===============================
 * * NOTHING IS HIDDEN. A REPLY IS SHOWN WHOLE.
 * ===============================
 * This capped a reply at twelve lines behind "Show all 14 lines", and it
 * was the SECOND cut on the same answer: the tools already cap what they
 * read aloud, and the queue then arrived here and was cut again. Two
 * truncations, one of them a click.
 *
 * Removed 2026-09-17, his call. The collapse existed to stop a wall of
 * text, and the wall was a formatting problem: the review queue printed
 * thirty six run on sentences. It is grouped by company now, so the fix is
 * in what is SAID rather than in hiding half of it.
 *
 * A REPLY THAT NEEDS HIDING IS A REPLY THAT NEEDS REWRITING, and hiding it
 * is what stops anybody noticing.
 */
function Sources({ sources }) {
  const [open, setOpen] = useState(false);
  const site = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="dm-chip inline-flex min-h-0 items-center gap-1.5 rounded-full border border-diane-line/40 bg-transparent px-2 py-0.5 text-[10px] text-diane-dim hover:border-diane-signal/60 hover:text-diane-signal"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
        </svg>
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 text-[10px] leading-snug">
          {sources.map((s) => (
            <li key={s.n} className="min-w-0">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate text-diane-signal underline-offset-2 hover:text-white hover:underline" title={s.title}>
                  {s.title}
                  <span className="ml-1.5 text-white/40">
                    {site(s.url)}
                    {s.updatedOn ? ` · updated ${new Date(s.updatedOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </span>
                </a>
              ) : (
                <span className="block truncate text-white/70">Our note · {s.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bubble({ text, onOpenDeal }) {
  return linkify(text, onOpenDeal);
}

/**
 * ===============================
 * * A PICTURE SAYS IT: THE LONG TEXT STEPS ASIDE
 * ===============================
 * His call 2026-10-08: when her answer comes as a picture, the same answer
 * as a long list and a long reply under it is the clutter. In a turn with a
 * picture the list is not drawn, and her reply keeps its first line and its
 * last paragraph (what she found, and what she asks). Nothing is removed:
 * the conversation still holds every word, and she still reads it.
 */
function picturedTurns(history) {
  const turnOf = [];
  let turn = 0;
  for (const m of history) {
    if (m.role === 'user' && !m.list && !m.image && !m.card && !m.form && !m.check) turn += 1;
    turnOf.push(turn);
  }
  const withPicture = new Set(history.map((m, i) => (m.image?.id ? turnOf[i] : null)).filter((t) => t !== null));
  return (i) => withPicture.has(turnOf[i]);
}
function shortOf(text) {
  const all = String(text ?? '').trim();
  const paras = all.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 2 && all.split('\n').length <= 4) return all;
  const first = paras[0].split('\n')[0];
  const last = paras[paras.length - 1];
  return first === last ? first : `${first}\n\n${last}`;
}

export default function Messages({
  history, isSending, workingText, progress = null, streamingReply = '', onFormSubmit, onCellEdit,
  onExportPause, onOpenDeal, onRetry, onOffer, onOpenImage,
}) {
  const pictured = picturedTurns(history);
  return (
    <>
      {history.map((m, i) => (pictured(i) && m.list && !m.image) ? null : (
        /**
         * A FORM IS A TURN, so it sits in the transcript rather than
         * floating somewhere else on screen. It scrolls away with the
         * conversation like everything else, and what she said just before
         * it stays attached to it.
         *
         * Wider than a bubble: 85% of a narrow strip is not enough for two
         * columns of inputs.
         */
        /**
         * THE EXPORT PANEL IS A TURN TOO, and a paused one collapses to a
         * chip rather than vanishing: a session that disappears when paused
         * is one nobody comes back to.
         */
        m.exportSession ? (
          <div key={i} data-export-summary className="dm-turn self-start w-full max-w-[95%]">
            {m.paused ? (
              <button
                type="button"
                onClick={() => onExportPause?.(i, false)}
                className="w-full rounded-xl border border-diane-line/30 bg-diane-sunken/80 px-3 py-2 text-left text-[11px] text-white/50 hover:border-diane-signal/40 hover:text-white/90"
              >
                <span className="block truncate text-diane-signal">{m.exportSession.fileName ?? 'Export preview'}</span>
                <span className="mt-0.5 block">Paused | tap to carry on</span>
              </button>
            ) : (
              <div className="px-0.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[11px] text-diane-signal">
                    {m.exportSession.fileName ?? 'Export preview'}
                  </span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-white/30">On Diane</span>
                </div>
                <span className="mt-0.5 block text-[10px] text-white/35">
                  {m.exportSession.preview?.rows ?? 0} rows | {m.exportSession.preview?.people ?? 0} people
                </span>
              </div>
            )}
          </div>
        ) : m.check ? (
          /* THE SHEET CHECK. Its own turn, and no card: see SheetCheck. */
          <div key={i} className="dm-turn self-start w-full max-w-[95%]">
            <SheetCheck check={m.check} onOpen={onOpenDeal} />
          </div>
        ) : m.offer ? (
          /* ONE QUESTION SHE ASKS AFTERWARDS: auto mode, or whether a new
             deal is a special case. Its own turn in the transcript, so it
             scrolls away with the thing it is about rather than floating
             somewhere else on screen. See TurnOffer. */
          <div key={i} className="dm-turn self-start w-full max-w-[95%]">
            <TurnOffer
              offer={m.offer}
              answered={m.answered}
              disabled={isSending}
              onAnswer={(choice) => onOffer?.(i, choice)}
            />
          </div>
        ) : m.image ? (
          /* THE EXPENSE PICTURE, under her card. Click to open it large. */
          <div key={i} className="dm-turn self-start w-full max-w-[95%]">
            <ExpenseImage image={m.image} onOpen={onOpenImage} />
          </div>
        ) : m.list ? (
          <div key={i} className="dm-turn self-start w-full max-w-[95%]">
            {m.list.kind === 'recent-changes'
              ? <RecentChangesList list={m.list} onOpen={onOpenDeal} />
              : m.list.kind === 'companies'
                ? <CompanyList list={m.list} />
                : m.list.kind === 'review' || m.list.kind === 'report' || m.list.kind === 'plan'
                  ? <SectionedList list={m.list} onOpen={onOpenDeal} />
                  : <DealList list={m.list} onOpen={onOpenDeal} />}
          </div>
        ) : m.card ? (
          <div key={i} className="dm-turn self-start w-full max-w-[95%]">
            <DealCard
              card={m.card}
              disabled={isSending}
              onEdit={(field, value) => onCellEdit?.(m.card, field, value)}
            />
          </div>
        ) : m.form ? (
          <div key={i} className="dm-turn self-start w-full max-w-[95%]">
            <DealForm
              form={m.form}
              disabled={isSending}
              onSubmit={(filled, form) => onFormSubmit?.(filled, form)}
            />
          </div>
        ) : (
        <div
          key={i}
          className={`dm-msg ${m.role === 'assistant' ? 'dm-her' : 'dm-you'} max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-snug whitespace-pre-wrap break-words ${
            m.role === 'assistant'
              ? 'self-start text-white/90 border border-diane-line/35 bg-diane-panel/70'
              // Their words in the orb's own sweep, signal into accent.
              : 'self-end text-diane-void font-medium bg-gradient-to-br from-diane-signal to-diane-accent'
          }`}
        >
          <Bubble
            text={m.role === 'assistant' && pictured(i) ? shortOf(m.content) : m.content}
            onOpenDeal={m.role === 'assistant' ? onOpenDeal : null}
          />

          {/* HER SOURCES, LIKE CHATGPT (his call 2026-10-10): hidden behind a
              small button under the answer, clickable links when opened. Never
              in her words, so she never reads a link aloud. */}
          {m.role === 'assistant' && m.sources?.length > 0 && <Sources sources={m.sources} />}

          {/* RETRY, on the turn that failed. Her excuse is in character and
              deliberately vague, which left retyping the question as the
              only way forward. The question is still in history. */}
          {m.failed && (
            <button
              type="button"
              onClick={onRetry}
              className="dm-chip mt-1.5 min-h-0 rounded-full border border-diane-line/40 bg-transparent px-2 py-0.5 text-[10px] text-diane-dim hover:border-diane-signal/60 hover:text-diane-signal"
            >
              Ask again
            </button>
          )}
        </div>
        )
      ))}

      {/* The reply as it arrives. Styled exactly like a finished assistant
          bubble, so when the turn completes and it moves into `history`
          nothing on screen shifts or restyles — it simply stops growing.
          A caret marks it as still being written. */}
      {isSending && streamingReply && (
        <div className="dm-msg dm-her dm-live self-start max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-snug whitespace-pre-wrap break-words text-white/90 border border-diane-line/35 bg-diane-panel/70">
          {streamingReply}
          <span className="dm-caret ml-0.5 inline-block w-[2px] h-[1em] align-text-bottom bg-diane-signal animate-pulse" />
        </div>
      )}

      {/**
        * WHAT SHE IS WRITING, ROW BY ROW.
        *
        * Ninety six rows is several seconds of silence, and silence is
        * indistinguishable from a hang. This is what let the bulk cap come
        * up from sixty to the whole sheet: the old rule was "a partial mass
        * edit is worse than none, because nobody can tell which half ran",
        * and the answer to that is to SHOW which half ran.
        *
        * It replaces the working phrase rather than sitting under it: two
        * things saying "still going" is one too many.
        */}
      {isSending && progress && (
        <div className="dm-progress self-start w-full max-w-[95%] rounded-lg border border-diane-line/35 bg-diane-panel/70 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/80">
            <Working>{progress.label ?? 'Working'}</Working>
            <span className="tabular-nums text-white/50">
              {progress.done} of {progress.total}
              {progress.failed > 0 && (
                <span className="text-diane-warn"> · {progress.failed} failed</span>
              )}
            </span>
          </div>

          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="dm-progress-bar h-full rounded-full bg-diane-signal transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
            />
          </div>

          {/* The row it is on, so it reads as work happening rather than a
              number climbing on its own. */}
          {progress.row && (
            <p className="m-0 mt-1 truncate text-[9px] text-white/40">{progress.row}</p>
          )}
        </div>
      )}

      {/* Only until the first token lands. Once she is writing, the words
          themselves are the progress and a "one second" bubble underneath
          them reads as a second, stuck reply. */}
      {isSending && !streamingReply && !progress && (
        <div className="dm-msg dm-her dm-working self-start max-w-[85%] rounded-lg px-3 py-2 text-[11px] text-white/50 border border-diane-line/25 bg-diane-panel/50">
          <Working>{workingText}</Working>
        </div>
      )}
    </>
  );
}
