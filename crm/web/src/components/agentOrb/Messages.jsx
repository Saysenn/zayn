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
import DealForm from './forms/DealForm';
import DealCard from './forms/DealCard';
import DealList from './forms/DealList';
import RecentChangesList from './forms/RecentChangesList';
import CompanyList from './forms/CompanyList';
import SectionedList from './forms/SectionedList';
import TurnOffer from './TurnOffer';
import SheetCheck from './forms/SheetCheck';
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
function Bubble({ text, onOpenDeal }) {
  return linkify(text, onOpenDeal);
}

export default function Messages({
  history, isSending, workingText, progress = null, streamingReply = '', onFormSubmit, onCellEdit,
  onExportPause, onOpenDeal, onRetry, onOffer,
}) {
  return (
    <>
      {history.map((m, i) => (
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
          <div key={i} data-export-summary className="self-start w-full max-w-[95%]">
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
          <div key={i} className="self-start w-full max-w-[95%]">
            <SheetCheck check={m.check} onOpen={onOpenDeal} />
          </div>
        ) : m.offer ? (
          /* ONE QUESTION SHE ASKS AFTERWARDS: auto mode, or whether a new
             deal is a special case. Its own turn in the transcript, so it
             scrolls away with the thing it is about rather than floating
             somewhere else on screen. See TurnOffer. */
          <div key={i} className="self-start w-full max-w-[95%]">
            <TurnOffer
              offer={m.offer}
              answered={m.answered}
              disabled={isSending}
              onAnswer={(choice) => onOffer?.(i, choice)}
            />
          </div>
        ) : m.list ? (
          <div key={i} className="self-start w-full max-w-[95%]">
            {m.list.kind === 'recent-changes'
              ? <RecentChangesList list={m.list} onOpen={onOpenDeal} />
              : m.list.kind === 'companies'
                ? <CompanyList list={m.list} />
                : m.list.kind === 'review' || m.list.kind === 'report' || m.list.kind === 'plan'
                  ? <SectionedList list={m.list} onOpen={onOpenDeal} />
                  : <DealList list={m.list} onOpen={onOpenDeal} />}
          </div>
        ) : m.card ? (
          <div key={i} className="self-start w-full max-w-[95%]">
            <DealCard
              card={m.card}
              disabled={isSending}
              onEdit={(field, value) => onCellEdit?.(m.card, field, value)}
            />
          </div>
        ) : m.form ? (
          <div key={i} className="self-start w-full max-w-[95%]">
            <DealForm
              form={m.form}
              disabled={isSending}
              onSubmit={(filled, form) => onFormSubmit?.(filled, form)}
            />
          </div>
        ) : (
        <div
          key={i}
          className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-snug whitespace-pre-wrap break-words ${
            m.role === 'assistant'
              ? 'self-start text-white/90 border border-diane-line/35 bg-diane-panel/70'
              // Their words in the orb's own sweep, signal into accent.
              : 'self-end text-diane-void font-medium bg-gradient-to-br from-diane-signal to-diane-accent'
          }`}
        >
          <Bubble
            text={m.content}
            onOpenDeal={m.role === 'assistant' ? onOpenDeal : null}
          />

          {/* RETRY, on the turn that failed. Her excuse is in character and
              deliberately vague, which left retyping the question as the
              only way forward. The question is still in history. */}
          {m.failed && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1.5 min-h-0 rounded-full border border-diane-line/40 bg-transparent px-2 py-0.5 text-[10px] text-diane-dim hover:border-diane-signal/60 hover:text-diane-signal"
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
        <div className="self-start max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-snug whitespace-pre-wrap break-words text-white/90 border border-diane-line/35 bg-diane-panel/70">
          {streamingReply}
          <span className="ml-0.5 inline-block w-[2px] h-[1em] align-text-bottom bg-diane-signal animate-pulse" />
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
        <div className="self-start w-full max-w-[95%] rounded-lg border border-diane-line/35 bg-diane-panel/70 px-3 py-2">
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
              className="h-full rounded-full bg-diane-signal transition-[width] duration-200 ease-out"
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
        <div className="self-start max-w-[85%] rounded-lg px-3 py-2 text-[11px] text-white/50 border border-diane-line/25 bg-diane-panel/50">
          <Working>{workingText}</Working>
        </div>
      )}
    </>
  );
}
