import { useEffect, useRef, useState } from 'react';
import { apiService } from '../../../configs/api.config';
import { useSocketEvent } from '../../../hooks/useSocket';
import CellInfo from '../../display/CellInfo';


/**
 * ***************************************************
 * * The export card: agree to it, or say what to change
 * ***************************************************
 *
 * IT WAS A FORM AND THE FORM WAS THE MISTAKE. Twenty four checkboxes, a
 * colour picker and a delivery toggle inside a chat window is a modal done
 * worse, and it re-counted on every tick, which dragged itself off screen
 * while somebody was reading it.
 *
 * The flow is now: TALK IT THROUGH, SEE ONE CARD, AGREE, BUILD. She gathers
 * the shape, the columns, the breakdown and the colour in conversation,
 * then this draws the finished thing once. Changing something is a
 * sentence, and she redraws it.
 *
 * READ ONLY BY DESIGN. It fetches nothing and decides nothing: everything
 * here arrives in one tool result, so it cannot disagree with the file and
 * cannot move under the reader.
 */

const LABEL = 'text-[10px] uppercase tracking-wide text-white/40';

/**
 * HOW FAR IN THEY ARE, and what is still outstanding.
 *
 * The gathering had no shape: she asked for a group, they answered
 * something else, and nothing on screen said an export was half built.
 * Derived server side from the draft, so it cannot claim a step is settled
 * when the file says otherwise.
 *
 * Deliberately small. It is a reassurance, not a wizard: the questions are
 * hers and the answers are sentences.
 */
function Tracker({ stages }) {
  if (!stages?.steps?.length) return null;

  return (
    <div className="mt-2 border-t border-diane-line/20 pt-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className={LABEL}>Building</span>
        <span className="text-[10px] tabular-nums text-white/35">
          {stages.done} of {stages.total}
        </span>
      </div>

      {/* One bar per step, filled as it settles. A row of thin bars reads
          as progress at a glance where a list of ticks reads as a form. */}
      <div className="flex gap-1">
        {stages.steps.map((s) => (
          <div
            key={s.id}
            title={`${s.label}: ${s.value}`}
            className={`h-0.5 flex-1 rounded-full ${
              s.done ? 'bg-diane-signal' : s.id === stages.next ? 'bg-diane-signal/40 animate-pulse' : 'bg-white/10'
            }`}
          />
        ))}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {stages.steps.map((s) => (
          <span
            key={s.id}
            className={`text-[10px] ${
              s.done ? 'text-white/45' : s.id === stages.next ? 'text-diane-signal' : 'text-white/20'
            }`}
          >
            {s.label}
            {s.done && <span className="text-white/25"> {s.value}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * THE CHOICES FOR THE STEP SHE IS ASKING ABOUT, and only that step.
 *
 * NOT the form coming back. One question is on the table at a time, so this
 * is at most a handful of chips, and every one of them is also sayable: the
 * click sends the same sentence they could have typed, so there is one path
 * through the tool and one place the answer is recorded.
 *
 * SERVED, NEVER TYPED. She told an admin the breakdown designs were "none,
 * simple, detailed and full". Three of those do not exist. Nothing had ever
 * given her the list, so she made one up, and the same would happen here.
 */
// Inside the card the chips sit under a rule, in their own section. Pinned
// above the input they are the section, so the rule and the top margin
// would draw a line across nothing.
const wrap = (bare, base) => (bare ? base : `mt-2 border-t border-diane-line/20 pt-2 ${base}`);

export function Choices({
  step, options, draft, onSay, busy, bare = false,
}) {
  if (!step || !options) return null;

  const chip = 'min-h-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40';
  const off = 'border-diane-line/20 bg-diane-void/75 text-white/60 hover:border-diane-signal/40 hover:text-white';
  const on = 'border-diane-signal/60 bg-diane-signal font-semibold text-diane-void';

  if (step === 'groups') {
    const chosen = new Set(draft.groups ?? []);
    return (
      <div className={wrap(bare, "flex flex-wrap gap-1")}>
        {(options.groups ?? []).map((g) => (
          <button
            key={g} type="button" disabled={busy}
            onClick={() => onSay(chosen.has(g) ? `not ${g}` : `${g}`)}
            className={`${chip} ${chosen.has(g) ? on : off}`}
          >
            {g}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => onSay('all of them')} className={`${chip} ${off}`}>
          All groups
        </button>
      </div>
    );
  }

  if (step === 'breakdown') {
    /**
     * ===============================
     * * TEXT, NOT A GALLERY
     * ===============================
     *
     * This drew a real sample of each of the four designs, scaled down and
     * growing on hover. It read as a picture gallery in the middle of a
     * conversation, and the choice is nearly always the default anyway:
     * `DEFAULT_ID` on the server is the USD + add ons table, so the card
     * arrives already set to it.
     *
     * So the alternatives are named, not drawn. The description is on the
     * chip rather than in a `title`, which is a tooltip nobody hovers and
     * no touch screen has. Same shape as the sheet step below.
     */
    return (
      <div className={wrap(bare, 'grid max-h-40 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2')}>
        {(options.designs ?? []).map((d) => {
          const picked = draft.breakdownDesign === d.id;
          return (
            <button
              key={d.id} type="button" disabled={busy}
              onClick={() => onSay(`use the ${d.label} breakdown`)}
              className={`min-w-0 overflow-hidden rounded-xl border px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${
                picked
                  ? 'border-diane-signal/55 bg-diane-signal/15'
                  : 'border-diane-line/20 bg-diane-void/75 hover:border-diane-signal/35 hover:bg-diane-signal/10'
              }`}
            >
              <span className={`block text-[11px] ${picked ? 'text-diane-signal' : 'text-white/80'}`}>
                {d.label}
              </span>
              {d.description && (
                <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-white/35">{d.description}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (step === 'colour') {
    /**
     * A DOT IS NOT A PREVIEW. Five circles told nobody what the sheet
     * would look like, and the colour is the one choice that is purely
     * visual. Each swatch is now three bands in the weights the file
     * actually writes: the heading in the strong colour, then the two
     * supporting rows in the soft one, with the name underneath.
     */
    return (
      <div className={wrap(bare, 'flex flex-wrap items-end gap-1.5')}>
        {(options.colors ?? []).map((c) => (
          <button
            key={c.id} type="button" disabled={busy}
            onClick={() => onSay(`make it ${c.label.toLowerCase()}`)}
            className={`min-h-0 rounded-lg border p-1.5 transition-colors ${
              draft.primaryColor === c.id
                ? 'border-diane-signal bg-diane-signal/10'
                : 'border-transparent bg-diane-void hover:border-diane-line/35'
            }`}
          >
            <span className="block w-9 overflow-hidden rounded-sm">
              <span className="block h-2" style={{ background: c.strong }} />
              <span className="block h-1 border-t border-black/20" style={{ background: c.soft }} />
              <span className="block h-1 border-t border-black/20" style={{ background: c.soft }} />
            </span>
            <span className={`mt-1 block text-[9px] ${draft.primaryColor === c.id ? 'text-diane-signal' : 'text-white/45'}`}>
              {c.label}
            </span>
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => onSay('any colour is fine')} className={`${chip} ${off} mb-1`}>
          Any
        </button>
      </div>
    );
  }

  if (step === 'delivery') {
    return (
      <div className={wrap(bare, "flex flex-wrap gap-1")}>
        <button type="button" disabled={busy} onClick={() => onSay('one file with a tab per group')} className={`${chip} ${draft.multiFile ? off : on}`}>
          One file, a tab per group
        </button>
        <button type="button" disabled={busy} onClick={() => onSay('one file per group, zipped')} className={`${chip} ${draft.multiFile ? on : off}`}>
          A file per group, zipped
        </button>
      </div>
    );
  }

  if (step === 'columns') {
    return (
      <div className={wrap(bare, "flex flex-wrap gap-1")}>
        <button type="button" disabled={busy} onClick={() => onSay('the columns are fine')} className={`${chip} ${off}`}>
          Columns are fine
        </button>
      </div>
    );
  }

  if (step === 'sheet') {
    // WITH ITS DESCRIPTION, the same as the breakdown step. Bare
    // names told nobody the difference between "cash" and "master sheet",
    // and the description was in a `title`, which is a tooltip nobody
    // hovers and no touch screen has. Planned shapes stay visible with an
    // availability label, but native disabled semantics prevent an answer.
    return (
      <div className={wrap(bare, 'grid max-h-40 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2')}>
        {(options.templates ?? []).map((t) => (
          <button
            key={t.id} type="button" disabled={busy || t.disabled}
            onClick={t.disabled ? undefined : () => onSay(`the ${t.label}`)}
            className={`min-w-0 overflow-hidden rounded-xl border px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${
              draft.template === t.id
                ? 'border-diane-signal/55 bg-diane-signal/15'
                : 'border-diane-line/20 bg-diane-void/75 hover:border-diane-signal/35 hover:bg-diane-signal/10'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={`block text-[11px] ${draft.template === t.id ? 'text-diane-signal' : 'text-white/80'}`}>
                {t.label}
              </span>
              {t.availability && (
                <span className="shrink-0 rounded-full border border-diane-signal/25 bg-diane-signal/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-diane-signal/75">
                  {t.availability}
                </span>
              )}
            </span>
            {t.description && (
              <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-white/35">{t.description}</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return null;
}

// How many warnings show before the rest go behind a count. Four is about
// a third of the card; past that they push the preview and the build
// button off it, which are the two things you came here for.
const WARNINGS_SHOWN = 4;

function Warnings({ warnings }) {
  const [all, setAll] = useState(false);
  const shown = all ? warnings : warnings.slice(0, WARNINGS_SHOWN);
  const hidden = warnings.length - shown.length;

  return (
    <div className="mt-2 border-t border-diane-line/20 pt-2">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {shown.map((w) => (
          <li
            key={`${w.kind}-${w.group}`}
            className={`text-[10px] ${w.severity === 'info' ? 'text-white/45' : 'text-diane-warn'}`}
          >
            <span className="text-white/30">{w.group}</span> {w.text}
          </li>
        ))}
      </ul>
      {(hidden > 0 || all) && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 min-h-0 border-0 bg-transparent p-0 text-[9px] uppercase tracking-wide text-white/35 hover:text-diane-signal"
        >
          {all ? '▾ Show fewer' : `▸ ${hidden} more`}
        </button>
      )}
    </div>
  );
}

function Line({ label, children }) {
  return (
    <div className="flex gap-2 text-[10px]">
      <span className={`${LABEL} w-20 shrink-0 pt-px`}>{label}</span>
      <span className="text-white/75">{children}</span>
    </div>
  );
}

export default function ExportSession({
  session, onBuild, onCancel, onPause, onSay, busy, overlay = false,
}) {
  const { draft, query } = session;
  const [progress, setProgress] = useState(null);

  /**
   * THE FIGURES ARE NEVER REMEMBERED, only the config.
   *
   * `session` carries the card she drew. That was true when she drew it,
   * and it stops being true the moment anybody edits a row: a count on a
   * document about to be sent must not be a snapshot.
   *
   * So the counts, the warnings, the columns and the five rows are
   * REBUILT from the query, off the same builder her tool used. On mount,
   * which covers a page reload, and again whenever the sheet changes.
  */
  const [live, setLive] = useState(null);
  // /export/card refreshes only the volatile figures. Keep the workflow
  // fields Diane served with the session, especially stages and options.
  // Replacing the object here made her ask a question while showing no
  // answers, because the refresh response does not carry those fields.
  const card = live ? { ...session, ...live } : session;
  const { preview, columns = [], fileName, stages, options } = card;

  const key = JSON.stringify(query ?? {});
  const refresh = useRef(() => {});
  refresh.current = () => {
    if (!query) return;
    apiService.exports.card(query)
      .then((fresh) => setLive(fresh))
      // A failed refresh keeps what she drew rather than blanking the
      // card. It is stale, but it is the last thing that was true.
      .catch(() => {});
  };

  useEffect(() => { setLive(null); refresh.current(); }, [key]);
  useSocketEvent('master-sheet:changed', () => refresh.current());

  // SAYING GO BUILDS IT. Fired once per card, so a re-render cannot
  // download the same file twice.
  const builtRef = useRef(null);
  useEffect(() => {
    if (!session.build || builtRef.current === session) return;
    builtRef.current = session;
    onBuild(query, fileName, setProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const shell = overlay
    ? 'agent-scroll max-h-full overflow-y-auto rounded-2xl border border-diane-signal/35 bg-diane-panel/90 p-3 shadow-2xl backdrop-blur-xl sm:p-4'
    : 'rounded-lg border border-diane-line/30 bg-diane-sunken p-2.5';

  /**
   * DURING THE QUESTIONS, SHOW ONLY THE QUESTION.
   *
   * The complete document preview looked final at step zero and buried the
   * small set of answers Diane was waiting for. This compact setup card is
   * the live part of the conversation. The document details appear only
   * after every stage is settled.
   */
  if (stages?.next) {
    const current = stages.steps.find((step) => step.id === stages.next);
    return (
      <div data-export-card data-export-decision className={shell}>
        {overlay && <div className="mb-3 h-px bg-gradient-to-r from-transparent via-diane-signal/70 to-transparent" />}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="mb-0.5 block text-[9px] uppercase tracking-[0.22em] text-diane-signal/65">
              Export setup
            </span>
            <p className="m-0 text-sm font-semibold text-white/90">
              Choose {current?.label?.toLowerCase() ?? 'an option'}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-diane-line/25 bg-diane-void/60 px-2 py-1 text-[10px] tabular-nums text-white/55">
            {stages.done} of {stages.total}
          </span>
        </div>

        <Tracker stages={stages} />
        <Choices step={stages?.next} options={options} draft={draft} onSay={onSay} busy={busy} />

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-diane-line/20 pt-2">
          <p className="m-0 text-[10px] text-white/35">Choose here, or answer Diane in the conversation.</p>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onPause} className="min-h-0 rounded border-0 bg-transparent px-1.5 py-0.5 text-[11px] text-white/50 hover:text-white/90">
              Pause
            </button>
            <button type="button" onClick={onCancel} className="min-h-0 rounded border-0 bg-transparent px-1.5 py-0.5 text-[11px] text-white/50 hover:text-white/90">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const scope = [
    draft.month,
    draft.groups?.length ? draft.groups.join(', ') : 'every group',
    draft.method,
    draft.currency,
    draft.status?.replace('_', ' '),
  ].filter(Boolean).join(' · ');

  return (
    <div data-export-card className={shell}>
      {overlay && <div className="mb-3 h-px bg-gradient-to-r from-transparent via-diane-signal/70 to-transparent" />}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {overlay && (
            <span className="mb-0.5 block text-[9px] uppercase tracking-[0.22em] text-diane-signal/65">
              Export preview
            </span>
          )}
          <p className="m-0 truncate text-[12px] font-semibold text-diane-signal">{fileName}</p>
        </div>
        <span className="shrink-0 rounded-full border border-diane-line/25 bg-diane-void/60 px-2 py-1 text-[10px] tabular-nums text-white/55">
          {preview?.rows ?? 0} rows · {preview?.people ?? 0} people
        </span>
      </div>

      <Tracker stages={stages} />

      {/* Only the step she is on. Clicking says the same sentence they
          could have typed, so there is one path through the tool. */}
      <Choices step={stages?.next} options={options} draft={draft} onSay={onSay} busy={busy} />

      <div className="mt-2 space-y-1 rounded-xl border border-diane-line/15 bg-diane-void/45 px-3 py-2">
        <Line label="Covering">{scope}</Line>
        {/* THE COUNT AND THREE NAMES, not all twenty two.
            This printed every header joined by commas, which on a master
            sheet export wrapped to four or five lines: the single tallest
            thing on the card, and it said nothing the count did not. The
            full list is one hover away. */}
        <Line label="Columns">
          {columns.length}
          {columns.length > 0 && (
            <>
              {' · '}
              <span className="text-white/45">
                {columns.slice(0, 3).map((c) => c.header).join(', ')}
                {columns.length > 3 && ` and ${columns.length - 3} more`}
              </span>
              {columns.length > 3 && (
                <CellInfo
                  size={11}
                  label="Every column in this file"
                  className="ml-1 !text-diane-dim hover:!text-diane-signal"
                >
                  {columns.map((c) => c.header).join(', ')}
                </CellInfo>
              )}
            </>
          )}
        </Line>
        <Line label="Breakdown">{draft.breakdownDesign?.replace(/-/g, ' ') ?? 'none'}</Line>
        {draft.primaryColor && <Line label="Colour">{draft.primaryColor}</Line>}
        <Line label="Delivery">
          {draft.multiFile && draft.groups?.length !== 1 ? 'a file per group, zipped' : 'one file, a tab per group'}
        </Line>
      </div>

      {/* WHAT WILL BE WRONG WITH IT, before it is built. The field names
          are the server's own and are pinned by a test on each side. */}
      {/* CAPPED. The list is one line per group per problem and nothing
          bounded it, so a sheet with something wrong in every group pushed
          the preview and the build button off the card entirely. */}
      {preview?.warnings?.length > 0 && (
        <Warnings warnings={preview.warnings} />
      )}

      {/* A PERCENTAGE IN A LABEL IS NOT A PROGRESS INDICATOR. The bar fills
          the button itself, so the work is visible without reading. */}
      <button
        type="button"
        disabled={busy || !preview?.rows || Boolean(stages?.next)}
        onClick={() => onBuild(query, fileName, setProgress)}
        className={`relative mt-3 w-full overflow-hidden rounded-xl border-0 py-2 text-sm font-bold disabled:opacity-40 ${
          progress === null ? 'bg-diane-signal text-diane-void' : 'bg-diane-signal/10 text-diane-signal'
        }`}
      >
        {progress !== null && (
          <span
            className="absolute inset-y-0 left-0 bg-diane-signal/25 transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        )}
        <span className="relative">
          {stages?.next
            ? `Still deciding: ${stages.steps.find((x) => x.id === stages.next)?.label}`
            : (progress === null ? 'Build it' : `Building… ${progress}%`)}
        </span>
      </button>

      {/* The exit, always visible. Changing something is a sentence now,
          so this says so rather than offering controls. */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="m-0 text-[10px] text-white/30">Tell me what to change, or drop it whenever you like.</p>
        <div className="flex gap-1">
          <button type="button" onClick={onPause} className="min-h-0 rounded border-0 bg-transparent px-1.5 py-0.5 text-[11px] text-white/50 hover:text-white/90">
            Pause
          </button>
          <button type="button" onClick={onCancel} className="min-h-0 rounded border-0 bg-transparent px-1.5 py-0.5 text-[11px] text-white/50 hover:text-white/90">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
