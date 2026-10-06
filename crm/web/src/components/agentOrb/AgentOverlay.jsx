import {
  lazy, Suspense, useEffect, useMemo, useRef, useState,
} from 'react';
import { useVoiceInput } from './useVoiceInput';
import { useConversationLog } from './useConversationLog';
import { useSpeechSynthesis } from './useSpeechSynthesis';
import { useOpenaiSpeech } from './useOpenaiSpeech';
import { useFollowScroll } from './useFollowScroll';
import { apiService } from '../../configs/api.config';
import { saveBlob } from '../../helpers/api.helper';
import { useDiane } from './DianeContext';
import { useSession } from '../../hooks/useAuth';
import { useSettings, useUpdateSettings } from '../../hooks/useSettings';
import { useUpdateMasterSheetRow } from '../../hooks/useMasterSheet';
import ConfirmDialog from '../modals/ConfirmDialog';
import SessionTracker from './SessionTracker';
import ExportSession from './forms/ExportSession';
import OrbHud from './OrbHud';
import OrbVitals from './OrbVitals';
import DianeEnvironment from './DianeEnvironment';
import Messages from './Messages';
import DealModal from './forms/DealModal';
import ScrollMore from './ScrollMore';
import RichInput from './RichInput';
import AutoModeChip from './AutoModeChip';
import { speakableReply } from './speakableReply';
import { useDianeVitals } from './useDianeVitals';
import { commandCenterOf, tint as tintOf } from '../../configs/dianeTheme';
import { dianeOf } from '../../configs/themes';
import { useTheme } from '../../hooks/useTheme';
import { DianePaletteProvider, useDianePalette } from './DianePalette';
import { orbStateFor } from './orbStateFor';
import { useOrbSlot } from './particlesOrb/useOrbSlot';
import {
  MicIcon, SpeakerMuteIcon, SendIcon, WaveformIcon, ExpandIcon,
  DownloadIcon, ResetIcon,
} from '../icons';

// THE PARTICLES ORB, here and on the welcome page (his calls 2026-09-27 and
// 2026-09-28). The loading screen keeps the particle field.
const ParticlesOrb = lazy(() => import('./particlesOrb/ParticlesOrb'));

// How much of its slot the orb draws over. Past 1: the sphere sits inside its
// canvas with a margin, so the canvas overhangs and the dots reach the brackets.
const ORB_FILL = 1.15;

// Exported so the "Ask the agent" button (MasterSheetPage.jsx) can call
// this on hover/focus, before the click — a bare import() just warms the
// browser's module cache, so by the time someone actually clicks, this
// promise (or its result) is usually already sitting there.
export function prefetchOrb() {
  import('./particlesOrb/ParticlesOrb');
}


// Shown in the orb's exact slot while its chunk loads — same size, a plain
// CSS pulse (no Three.js, no canvas), so there's never a blank gap.
function OrbPlaceholder() {
  const { tint } = useDianePalette();
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div
        className="w-2/3 h-2/3 rounded-full animate-pulse"
        style={{ background: `radial-gradient(circle, ${tint(0.35)} 0%, ${tint(0.06)} 70%, transparent 100%)` }}
      />
    </div>
  );
}

// Her first line sets the register before the model says a word, so it is
// written in her voice: bright, warm, a little flirty.
//
// SHORTER. It ran to three lines at the top of every conversation, forever,
// and the third one listed what she can do, which is the one part somebody
// reading it for the tenth time does not need.
const GREETING =
  "Hi, I'm Diane! Tell me what you need, sweetheart. Ask me anything, or tell me what to change.";

// How close to the bottom still counts as "following along". Generous,
// because a couple of pixels of rounding must not read as scrolled away.
const STICK_PX = 80;
// How long a click, wheel or touch in the panel holds the auto scroll off.
const HOLD_MS = 1500;

/**
 * ===============================
 * * AN OPEN EXPORT SURVIVES A RELOAD
 * ===============================
 * The transcript does not, by design: it is written to the database when
 * the conversation ENDS, never while it is happening. But an export they
 * are halfway through is work in progress, and losing it to a stray F5
 * means starting the whole conversation again.
 *
 * ONLY THE CONFIG IS KEPT. Never the counts, the warnings or the preview
 * rows: the card refetches those from the query on mount, so what comes
 * back after a reload is CURRENT rather than whatever was true when the
 * tab last had focus. A remembered figure on a document about to be sent
 * is the thing to avoid.
 *
 * sessionStorage, not localStorage, so it dies with the tab. Same
 * reasoning as the CRM's sticky filters.
 */
const EXPORT_KEY = 'diane.export';

function openExportFromStorage() {
  try {
    const raw = sessionStorage.getItem(EXPORT_KEY);
    if (!raw) return [];
    const { draft, query, paused } = JSON.parse(raw);
    if (!query) return [];
    return [{
      role: 'assistant',
      content: '[export card restored]',
      // No figures. The card fills them in from the server on mount.
      exportSession: { draft, query, build: false },
      paused: Boolean(paused),
    }];
  } catch {
    // A private window, cleared storage, or a shape from an older build.
    return [];
  }
}

function rememberExport(session, paused = false) {
  try {
    sessionStorage.setItem(EXPORT_KEY, JSON.stringify({
      draft: session.draft, query: session.query, paused,
    }));
  } catch { /* storage unavailable: the card still works, it just will not survive */ }
}

function forgetExport() {
  try { sessionStorage.removeItem(EXPORT_KEY); } catch { /* nothing to do */ }
}

/**
 * THE CONVERSATION SURVIVES A REFRESH, in this tab. A refresh closed her and
 * started over, mid task. 2026-10-06. The export card is left out: it has
 * its own key above and is put back from there.
 */
const CONVERSATION_KEY = 'diane.conversation';

function conversationFromStorage() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CONVERSATION_KEY) ?? 'null');
    return Array.isArray(saved) && saved.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

function rememberConversation(history) {
  try {
    sessionStorage.setItem(CONVERSATION_KEY, JSON.stringify(history.filter((m) => !m.exportSession)));
  } catch { /* storage unavailable or full: a refresh starts over, as before */ }
}

// Signed out: the transcript AND its id, or the next sign in in this tab
// would carry on, and file over, the last admin's conversation.
function forgetConversation() {
  try {
    sessionStorage.removeItem(CONVERSATION_KEY);
    sessionStorage.removeItem('diane.conversationId');
  } catch { /* nothing to do */ }
}

// Shown the instant a message sends, replaced once the real reply lands —
// user's own ask: a bare "…" doesn't tell you Diane's actually doing
// something, versus stuck. Picked once per send (not re-rolled every
// render) so it doesn't flicker between phrases while waiting.
const WORKING_PHRASES = [
  'Hang on, fetching that for you…',
  'One second, lovely…',
  'Ooh, let me pull that up…',
  'On it, sweetheart…',
];
function workingPhrase() {
  return WORKING_PHRASES[Math.floor(Math.random() * WORKING_PHRASES.length)];
}

/**
 * What she is actually doing, while she does it.
 *
 * A turn that spends three rounds looking things up used to show one
 * random "just a sec" for the whole wait, so a slow turn and a stuck one
 * looked identical. Saying which step she is on makes the same wait read
 * as progress.
 *
 * Keyed by tool name with a plain fallback, so a tool added later says
 * something sensible rather than nothing.
 */
const TOOL_PHRASES = {
  find_and_show_details: 'Looking them up…',
  filter_master_sheet: 'Narrowing the sheet…',
  export_sheet: 'Setting up your sheet…',
  total_master_sheet: 'Adding it up…',
  recall_past_conversations: 'Thinking back…',
  get_master_sheet_row_details: 'Reading the row…',
  edit_deal_form: 'Bringing up the form…',
  say: null,
  audit_master_sheet: 'Going through the sheet…',
  recent_master_sheet_changes: 'Checking what changed…',
  check_rates: 'Checking the rates…',
};

/**
 * ===============================
 * * A WRITE TOOL SAYS IT IS WRITING ONLY WHEN IT IS
 * ===============================
 * The same call runs twice: once without `confirmed`, which returns a
 * summary and changes nothing, and again after they agree. Saying
 * "Updating their profile…" over the first one is a claim she never made,
 * and the admin reads it as the change having happened. Reported on sight
 * 2026-09-24.
 *
 * The runtime sends `confirmed` with the event, so the word follows what
 * the call actually does. A write tool with no confirmation step reads as
 * preparing for its one call: understated, never a false claim.
 */
const PREPARING = 'Working out what that changes…';
const WRITING_PHRASES = {
  add_deal: 'Adding the deal…',
  update_master_sheet_row: 'Saving the change…',
  delete_master_sheet_row: 'Removing the row…',
  update_person: 'Updating their profile…',
  update_company: 'Saving the company…',
  rename_company: 'Renaming the company…',
  bulk_update_master_sheet: 'Working through the rows…',
  bulk_update_companies: 'Updating the companies…',
  bulk_close_companies: 'Closing the companies…',
  undo_master_sheet_change: 'Putting it back…',
};
function toolPhrase(name, confirmed = false) {
  const writing = WRITING_PHRASES[name];
  if (writing) return confirmed ? writing : PREPARING;
  return TOOL_PHRASES[name] ?? 'Working on it…';
}

// What she says instead of an error. Deliberately vague about the cause,
// because the causes (timeout, no key, rate limit, network) are all the
// same thing from where the admin is sitting, and none of them are
// actionable from a chat bubble. The real error still lands in the Logs
// page through the API's own captureLog.
// The square outlined controls in the header. One component rather than
// three copies of the same six Tailwind classes.
function HeaderButton({ children, onClick, label, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`w-10 h-10 flex items-center justify-center rounded-lg border min-h-0 p-0 transition-colors ${
        active
          ? 'border-diane-signal/60 text-diane-signal bg-diane-signal/10'
          : 'border-diane-line/40 text-diane-dim/70 bg-transparent hover:border-diane-signal/60 hover:text-diane-signal'
      }`}
    >
      {children}
    </button>
  );
}

// A small caps label. The command center is built out of labelled panels,
// and this is the label.
//
// FULL STRENGTH, not a fraction of it. `dim` is already the quiet end of
// the palette, and at 70% of it these were letters you could see were there
// without being able to read them. Anything faded from here is decoration,
// and none of these are.
function PanelLabel({ children, className = '' }) {
  return (
    <p className={`text-[0.6rem] uppercase tracking-[0.24em] text-diane-dim m-0 ${className}`}>
      {children}
    </p>
  );
}

/**
 * WHAT SHE IS DOING, ONE DEFINITION, two placements.
 *
 * The boxed version sits at the foot of the telemetry column, which only
 * exists where there is room for it. Below that it is a single line under
 * her, because the box would have to overlap the orb to fit. Same string
 * and the same dot either way, so the two can never say different things.
 *
 * The dot breathes only while she is genuinely working. A status light
 * that pulses at rest says nothing at all.
 */
function StatusReadout({ text, busy, compact = false }) {
  const dot = <span className={`w-1.5 h-1.5 shrink-0 rounded-full bg-diane-signal ${busy ? 'diane-live' : ''}`} />;

  if (compact) {
    return (
      <p
        className="flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.18em] text-diane-dim/75 m-0"
        aria-live="polite"
      >
        {dot}
        {text}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-diane-line/35 bg-diane-panel/70 px-3 py-2">
      <p className="flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.2em] text-diane-signal m-0">
        {dot}
        Online
      </p>
      <PanelLabel className="mt-1.5">System status</PanelLabel>
      <p className="text-[0.72rem] leading-snug text-white/65 m-0 mt-0.5" aria-live="polite">
        {text}
      </p>
    </div>
  );
}

// The inline level meter that used to sit in the command bar is gone. It
// reported the same `level` as the orb and the vitals panel's SIGNAL, so it
// was a third reading of one number inside the box you type in.

// The genuine catch-all — a timeout, a dropped connection, an unknown
// 5xx. Everything with a real cause (rate limit, too large, no key) now
// says so in its own words from the API, so this only covers failures
// where "something went wrong" is honestly all anyone knows.
//
// Deliberately says it's HER end, not the admin's. The old wording
// ("I didn't quite catch that one") implied they'd been unclear, and they
// were watching it appear after perfectly ordinary questions.
const RESTING_PHRASES = [
  "Something went wrong on my end there, sweetheart. Give me another go?",
  "That didn't come back to me properly, lovely. Try me once more?",
  "I dropped that one somewhere between here and there, honey. Ask me again?",
  "My end hiccuped just then, dear. It wasn't you at all. One more time?",
];

/**
 * The polishing agent's full-screen presence — user's own spec: dark
 * overlay, green glowing particle orb, type or talk to it. Opened from the
 * Master Sheet page's spark icon (MasterSheetPage.jsx).
 *
 * The agent's actual edits land through POST /master-sheet/agent
 * (masterSheet.js -> agent/runAgent.js), which broadcasts
 * 'master-sheet:changed' on every write — useMasterSheet.js already
 * listens for that, so the table behind this overlay refreshes itself.
 * Nothing here talks to master_sheet_rows directly.
 */
export default function AgentOverlay({ open, onClose }) {
  const { context, recheckAi } = useDiane();
  const [history, setHistory] = useState(() => [
    ...(conversationFromStorage() ?? [{ role: 'assistant', content: GREETING }]),
    ...openExportFromStorage(),
  ]);
  useEffect(() => { rememberConversation(history); }, [history]);
  // Saves the conversation when it ends, never while it is happening.
  // Closing the orb is a save point rather than an end, because the
  // transcript deliberately survives a close and reopen.
  const { save: saveConversation, noteTouched, endConversation } = useConversationLog(history);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  // Row by row, while a mass write runs. Declared with the rest of the
  // state rather than beside its use: a const is not hoisted, and a
  // reference above its declaration is the fault that crashed a page.
  const [progress, setProgress] = useState(null);
  const [workingText, setWorkingText] = useState('');
  // The reply as it arrives, held OUT of history: history is what gets
  // sent back to the model next turn, and a half-finished sentence must
  // never end up in it.
  const [streamingReply, setStreamingReply] = useState('');
  const [muted, setMuted] = useState(false);
  // Clearing the transcript is destructive to what is on screen and takes
  // a half built export with it, so it asks first.
  const [confirmingReset, setConfirmingReset] = useState(false);
  // The row a chip in her list was clicked on, or null. The modal fetches
  // the full card itself; this only holds which one.
  const [openDeal, setOpenDeal] = useState(null);
  // While a file is actually being generated. Pinned beside the input, not
  // only inside the card, which by then has usually scrolled away.
  const [buildProgress, setBuildProgress] = useState(null);
  // Her measured telemetry, for the panel beside the orb. Recorded at the
  // end of every turn, whichever way it ended.
  const vitals = useDianeVitals();
  // ONE SCROLLER. There were two, and the transcript was rendered into both
  // so a collapsed drawer still had a couple of exchanges under the orb.
  // The panel is permanent now, so the strip and its scroller are gone.
  const drawerScrollRef = useRef(null);
  const inputRef = useRef(null);
  const [orbSlotRef, orbSize] = useOrbSlot(ORB_FILL);
  const orbLevelRef = useRef(-1);

  // Prefer real OpenAI TTS (a real, consistent voice on every visitor's
  // machine) whenever OPENAI_TTS_API_KEY is actually set server-side;
  // fall back to the browser's own SpeechSynthesis otherwise, or if a
  // server call fails mid-session (openaiSpeech.available flips false).
  // Both hooks always run — cheap when idle — so switching between them
  // is just picking which object's `speak`/`speaking`/`level` to use,
  // never a conditional hook call.
  const openaiSpeech = useOpenaiSpeech();
  const browserSpeech = useSpeechSynthesis();
  const tts = openaiSpeech.available ? openaiSpeech : browserSpeech;
  // Record -> transcribe server-side -> send as a message. Same interface
  // the old browser-based recognition had, so nothing below changed when
  // one replaced the other.
  const stt = useVoiceInput({
    onResult: (transcript) => sendMessage(transcript),
  });
  // No separate useMicLevel any more: useVoiceInput already has an
  // analyser on the recording stream for silence detection, so the orb's
  // level comes from there. The old hook opened a SECOND concurrent
  // getUserMedia purely to visualise the same voice.

  // A quiet hint under the input, not a red error bar — the mic being
  // unavailable stops nothing, typing works throughout. Now that recording
  // is ours end to end, the messages it can carry are all actionable
  // (permission blocked, no microphone) rather than the old browser
  // recognition's unfixable "network error".
  const micHint = stt.error;

  // The mic is OFF until it's pressed — user's own call, reversing the
  // earlier voice-first behaviour.
  //
  // It used to re-arm itself after every turn, which meant opening Diane
  // put a live microphone on the page nobody asked for, and on a machine
  // where Chrome's speech service can't be reached it also meant a failure
  // message arriving on its own every few seconds. Press the mic, speak,
  // it transcribes and sends, and it goes quiet again.
  //
  // Typing is the default now, so the cursor goes to the box instead.
  // Waiting out tts.speaking matters here too: focusing mid-sentence is
  // fine, but the effect must not fight the user if they've clicked
  // elsewhere, hence the activeElement check.
  useEffect(() => {
    if (!open || isSending || tts.speaking || stt.listening || stt.transcribing) return;
    const active = document.activeElement;
    // The editor is a contentEditable div, so "is the box already focused"
    // is a containment test, not an identity one.
    const busyElsewhere =
      active && active !== document.body && !active.isContentEditable;
    if (busyElsewhere) return;
    inputRef.current?.focus();
  }, [open, isSending, tts.speaking, stt.listening, stt.transcribing]);

  useEffect(() => {
    if (!open && stt.listening) stt.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Signing out has to stop her mid-sentence.
  //
  // It didn't: the session going false unmounts the CRM, but a reply
  // already in flight still resolved, still called speak(), and the TTS
  // <audio> element is owned by a hook whose cleanup hadn't run yet — so
  // Diane carried on talking to a login screen. `signedOut` is also
  // checked after every await in sendMessage, so a turn that comes back
  // after a sign-out is dropped rather than spoken.
  // Same flag the Logs and Settings pages read — one switch for everything
  // that only exists to debug the system, rather than a second notion of
  // "developer" living in here.
  const { data: appSettings } = useSettings();
  const devMode = appSettings?.devMode ?? false;

  const { data: session } = useSession();
  const signedOut = session?.loggedIn === false;
  const signedOutRef = useRef(false);
  signedOutRef.current = signedOut;

  useEffect(() => {
    if (!signedOut) return;
    forgetConversation();
    tts.cancel();
    if (stt.listening) stt.stop();
    setIsSending(false);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut]);

  /**
   * ===============================
   * * STICK TO THE BOTTOM, BUT NEVER YANK
   * ===============================
   * It scrolled on every `history` change, and the export panel writes its
   * live state back into history on every recount. So ticking a column
   * dragged the panel off the bottom of the screen while somebody was
   * reading it, once per keystroke.
   *
   * Two conditions now, and both are needed. A NEW message, not an edited
   * one: a panel updating itself is not something arriving. And only if
   * they were already AT the bottom: somebody who has scrolled up to read
   * is reading, and moving the page under them is the rudest thing a chat
   * can do.
   */
  /**
   * ===============================
   * * WHERE THEY WERE BEFORE IT ARRIVED, not after
   * ===============================
   * This used to measure the distance from the bottom INSIDE the effect,
   * which runs after the new message has already been laid out. While her
   * reply grew token by token that worked: each frame added a line or two,
   * so the distance stayed under STICK_PX and it kept scrolling.
   *
   * The reply now lands whole, so a five line answer puts the bottom
   * hundreds of pixels away on the very first measurement, the test says
   * "they have scrolled up to read" and it never follows. Watching a
   * message arrive below the fold is the same bug in the other direction.
   *
   * So the scroll listener records it CONTINUOUSLY, and the effect reads
   * what was true before the message landed. Starts true: an empty
   * conversation is at its own bottom.
   */
  const stuckRef = useRef(true);
  const holdUntilRef = useRef(0);
  useEffect(() => {
    const el = drawerScrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    return () => el.removeEventListener('scroll', measure);
  }, [open]);
  // A click holds the panel still; a growing card is followed. See the hook.
  useFollowScroll(drawerScrollRef, stuckRef, holdUntilRef, { open, holdMs: HOLD_MS });

  const lastCount = useRef(0);
  useEffect(() => {
    const grew = history.length > lastCount.current;
    lastCount.current = history.length;
    if (!grew && !isSending) return;

    const el = drawerScrollRef.current;
    if (!el) return;
    const stuck = stuckRef.current;
    // Instant while an answer is still being written: a smooth scroll per
    // token never finishes one before the next starts, so the text creeps
    // below the fold while the animation chases it.
    // INSTANT, and once more a frame later. A smooth scroll fires scroll
    // events part way down, the listener above read those as "they
    // scrolled up", and the bubble that landed next (the "paid this month
    // anyway?" buttons) was left below the fold under the Latest pill.
    if (stuck && Date.now() > holdUntilRef.current) {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
    // `streamingReply` is a dependency because a growing answer is not a
    // history change: without it the reply outgrows the view unwatched.
  }, [history, isSending, streamingReply]);

  // Opening Diane lands on the newest message rather than wherever the
  // panel was left. `auto`, not `smooth`: animating a scroll through a long
  // history while the overlay is still appearing reads as a glitch.
  useEffect(() => {
    if (!open) return;
    const el = drawerScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open]);

  // Escape closes Diane. It used to close the conversation drawer first,
  // which was the only way out of an expanded one; the panel is permanent
  // now, so there is nothing between Escape and the CRM.
  // A DEAL OPEN ON TOP takes the Escape: it closed the pop-up AND Diane
  // behind it. 2026-09-30. The pop-up closes itself; she stays.
  useEffect(() => {
    if (!open || confirmingReset || openDeal) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, confirmingReset, openDeal]);

  // The orb closing is a SAVE POINT. Fire and forget: closing must never
  // wait on a write, and the save is idempotent so carrying on afterwards
  // simply writes a fuller transcript over the same row.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) saveConversation();
    wasOpen.current = open;
  }, [open, saveConversation]);

  // Lock the page behind Diane while she's open.
  //
  // The overlay is `fixed inset-0`, so it looks like it covers everything —
  // but a wheel over any part of it that isn't itself scrollable falls
  // through to the document, and the CRM silently scrolls underneath. Only
  // the panels inside here should move.
  //
  // The padding swap is what stops the page jolting sideways: hiding the
  // body's overflow removes the scrollbar, and everything reflows into the
  // space it was occupying. Replacing that exact width as padding keeps
  // the layout still. The previous values are captured and put back rather
  // than reset to '', so an inline style set elsewhere survives.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open]);

  // THE ORB SITS IN THE LAYOUT NOW, not in a `fixed` layer positioned from
  // a measured rect. That machinery existed for one thing: animating her
  // from her resting box to full screen for a reaction. Reactions are gone,
  // so what was left was a ResizeObserver, a
  // window listener and a piece of state keeping a fixed box on top of an
  // invisible one — and a stale `left` whenever the panel opened without
  // changing her width.

  // Used to be plain `autoFocus` on the input — worked fine when the panel
  // unmounted on close, since a fresh mount re-applies it every time. Now
  // that the panel stays mounted (hidden via CSS, not removed) so the orb
  // doesn't rebuild, the DOM node itself never remounts either, so autoFocus
  // would only ever fire once. This is the explicit replacement.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);



  /**
   * A filled form goes back as an ORDINARY MESSAGE.
   *
   * Not a direct write. The values reach Diane the way typed ones would
   * and she calls add_deal or update_master_sheet_row herself, so there is
   * one write path with one set of validation and one change-log entry. A
   * form that wrote straight to the API would be a second door onto the
   * same act, and the two would drift the first time either changed.
   *
   * The row id is repeated in the text on an edit because the model reads
   * the message, not the form object.
   */
  /**
   * A cell edited on a card, sent as words.
   *
   * Only reachable with CLICKABLE_CELLS on in DealCard, which is off by
   * default. Deliberately goes through the same door as everything else:
   * it becomes a sentence, she writes the row. Clicking and speaking end
   * up in the same place, which is what stops the card becoming a third
   * write path with its own validation.
   */
  function editCell(card, field, value) {
    sendMessage(`On deal #${card.id}, set ${field} to ${String(value).trim() || '(empty)'}.`);
  }

  function submitForm(filled, form) {
    const head = form.kind === 'edit-deal'
      ? `Update deal #${form.id} with these values, using update_master_sheet_row:`
      : 'Add this deal, using add_deal:';
    sendMessage(`${head}\n${filled.join('\n')}`);
  }

  /**
   * ===============================
   * * The export session's three exits
   * ===============================
   *
   * BUILD downloads the file the panel is describing, using the SAME query
   * it counted. Not a link: the download helper reports progress and keeps
   * the server's own filename, and a plain link would navigate the overlay
   * away from itself.
   *
   * PAUSE and CANCEL are different acts and each says what survives. Pause
   * keeps every choice and leaves a chip on screen. Cancel drops it, and
   * needs NO confirm: the whole session is read only and nothing has been
   * written, so "are you sure" would be confirming the destruction of
   * nothing.
   */
  // No `preview`: the counts come from the response. An unused argument is
  // an invitation to start reading it again.
  async function buildExport(query, fileName, setProgress) {
    try {
      /**
       * BUILDING IS NOT INSTANT AND IT LOOKED LIKE NOTHING.
       *
       * The only sign was a percentage inside the card's own button, and
       * the card is a transcript entry: press Build, ask something else,
       * and the one thing telling you a file was being made has scrolled
       * away. So the bar is pinned beside the input as well, where the
       * choices are, for exactly as long as the work runs.
       *
       * Two consumers, one source: the card keeps its own number for the
       * button label and this drives the pinned bar.
       */
      const both = (update) => {
        const pct = typeof update === 'number' ? update : update?.percent;
        if (!Number.isFinite(pct)) return;
        setProgress(pct);
        setBuildProgress({ pct, fileName, phase: update?.phase });
      };

      both(0);
      const {
        blob, filename, rows: builtRows, people: builtPeople,
      } = await apiService.exports.xlsx(query, both);
      // SAVING IS ITS OWN WAIT. On a picker the dialogue is open and the
      // write happens after, so the bar stays until the file is on disk.
      setBuildProgress({ pct: 100, fileName, saving: true });

      /**
       * THE SHARED SAVER, not a third copy of it.
       *
       * This had its own: no `document.body.appendChild`, which Firefox
       * needs, and `revokeObjectURL` in the SAME FRAME as the click, which
       * Firefox treats as cancelling the download. `saveBlob` in
       * api.helper.js documented both faults while this sat beside it
       * doing them.
       *
       * It also opens the real Save dialogue where the browser has one, so
       * the folder is theirs to pick.
       */
      const saved = await saveBlob(blob, filename || fileName);

      // THEY CLOSED THE DIALOGUE. Nothing was saved and nothing went
      // wrong, so she must not announce a file that is not on their disk.
      if (!saved) {
        const dropped = 'Left that one unsaved, lovely. Say the word and I will hand it over again.';
        setHistory((h) => [...h, { role: 'assistant', content: dropped }]);
        if (!muted) tts.speak(dropped);
        return;
      }

      /**
       * A DOWNLOAD IS SILENT, so she says what is in it.
       *
       * THE COUNTS COME FROM THE RESPONSE, never from the card. A 21 row
       * bank run was announced as "3 rows, 3 people" because this read a
       * client side preview that still held the previous export's figures.
       * A count computed on this side can always go stale; one that
       * travels with the file cannot disagree with it.
       *
       * `preview` is deliberately not consulted, even as a fallback: a
       * fallback is the same bug waiting for the header to go missing.
       * With no counts she says what she knows, which is the file name.
       */
      const has = Number.isFinite(builtRows) && Number.isFinite(builtPeople);
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      const said = has
        ? `${filename || fileName} is yours: ${plural(builtRows, 'row', 'rows')}, `
          + `${plural(builtPeople, 'person', 'people')}.`
        : `${filename || fileName} is yours.`;
      forgetExport();
      setHistory((h) => [
        ...h.filter((message) => !message.exportSession),
        { role: 'assistant', content: said },
      ]);
      if (!muted) tts.speak(said);
    } catch {
      // She never shows a raw error, same rule as a failed turn: the real
      // reason reaches the Logs page, and she says so in character here.
      const excuse = 'That one would not build on my end, lovely. Try me again?';
      setHistory((h) => [...h, { role: 'assistant', content: excuse }]);
      if (!muted) tts.speak(excuse);
    } finally {
      setProgress(null);
      setBuildProgress(null);
    }
  }

  /**
   * NOTHING PUSHES STATE BACK ANY MORE.
   *
   * The card is READ ONLY, so what she was handed and what is on screen are
   * the same object and cannot drift. That replaced a live panel which
   * wrote its state into history on every recount, which is also what kept
   * dragging the transcript to the bottom while somebody was reading it.
   */
  function pauseExport(index, paused) {
    setHistory((h) => h.map((m, i) => {
      if (i !== index) return m;
      if (m.exportSession) rememberExport(m.exportSession, paused);
      return { ...m, paused };
    }));
  }

  function cancelExport(index) {
    forgetExport();
    setHistory((h) => h.map((m, i) => (
      i === index ? { role: 'assistant', content: '[export cancelled]', cancelled: true } : m
    )));
  }

  /**
   * ===============================
   * * AUTO MODE, ANSWERED BY PRESSING RATHER THAN BY SAYING
   * ===============================
   * The button writes the setting itself. No model in the way, so a yes
   * here can never be read as a yes to a write waiting for one, which is
   * the ambiguity confirmReplay exists to keep out of writes.
   *
   * THE BUBBLE RECORDS WHICH WAY IT WENT, so the offer cannot be answered
   * twice and the transcript says what was chosen. It is not optimistic: a
   * setting that decides whether a write asks first must not read as ON
   * when the server refused it.
   */
  const updateSettings = useUpdateSettings();
  /**
   * DEFAULTS OFF, and `=== true` rather than `??`: while settings are
   * loading, or if the read fails, the chip must read "asks before
   * changing". Unknown is not permission.
   */
  const autoConfirm = appSettings?.agentAutoConfirm === true;

  function toggleAutoConfirm() {
    updateSettings.mutate({ agentAutoConfirm: !autoConfirm });
  }

  /**
   * ===============================
   * * ONE HANDLER, WHICHEVER QUESTION IT WAS
   * ===============================
   * Two kinds so far and they answer the same way: press, write, record
   * which way it went. `answered` is set only once the write lands, never
   * optimistically: a question about whether a write asks first, or about
   * whether somebody is paid this month, must not read as done when the
   * server refused it.
   */
  const updateDeal = useUpdateMasterSheetRow();

  function answerOffer(index, choice) {
    const entry = history[index];
    const mark = () => setHistory((h) => h.map((m, i) => (
      i === index ? { ...m, answered: choice } : m
    )));
    if (choice !== 'yes') { mark(); return; }

    if (entry?.offer?.kind === 'autoConfirm') {
      updateSettings.mutate({ agentAutoConfirm: true }, { onSuccess: mark });
      return;
    }
    if (entry?.offer?.kind === 'specialCase' && entry.offer.dealId) {
      updateDeal.mutate(
        { id: entry.offer.dealId, fields: { specialCaseDeal: true } },
        { onSuccess: mark },
      );
    }
  }

  /**
   * `base` is the history this turn builds on, and it defaults to the
   * current one. Only the retry passes it: `history` here is closed over
   * from this render, so a `setHistory` in the same tick has not landed and
   * the retry would send the very pair it just dropped.
   */
  async function sendMessage(text, base = history) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const nextHistory = [...base, { role: 'user', content: trimmed }];
    // They just spoke, so they are reading the bottom: follow the answer.
    stuckRef.current = true;
    setHistory(nextHistory);
    // Both: `input` is this component's plain-text mirror, and clear()
    // empties the editor's own DOM. The editor is uncontrolled by design
    // (a controlled contentEditable fights the caret on every keystroke),
    // so neither one clears the other.
    setInput('');
    inputRef.current?.clear();
    // A NEW QUESTION ENDS THE OLD ANSWER'S READING. She kept reading the
    // last list aloud while the next reply arrived. His call 2026-09-30.
    tts.cancel?.();
    setIsSending(true);
    setWorkingText(workingPhrase());

    // MEASURED HERE, at the two ends of the actual await, because the
    // vitals panel beside the orb reports it. A round trip timed anywhere
    // else is a different number wearing the same label.
    const startedAt = performance.now();
    let answered = false;

    try {
      // `context` is the workspace panel's current selection. The backend
      // gives Diane only that workspace's tools for this turn, so it isn't
      // a hint she may ignore — it decides what she's able to touch.
      // Diane no longer returns a reaction — the orb_reaction tool is gone
      // (user's call), so glow/sing/dance can't be requested of her any
      // more. Clicking the orb still bursts it; that's handled entirely in
      // the browser and never involved the model.
      // STREAMED. The turn takes as long as it always did; the difference
      // is the admin reads the first words while the rest is still being
      // written, instead of watching the orb until the last token lands.
      //
      // The partial answer is held here rather than pushed into `history`
      // per token: history is what gets sent back to the model next turn,
      // and a half-finished sentence must never end up in it.
      const {
        reply, claims = [], offer = null, spoken = null,
      } = await apiService.masterSheet.agentTurn(
        nextHistory,
        context,
        (event) => {
          if (signedOutRef.current) return;
          // REPLACE, never append. Each event carries the whole cleaned
          // reply so far, because the cleaning pass can rewrite text it
          // already sent: an asterisk pair closing one chunk later turns
          // what was shown into something different. See streamCompletion
          // in runAgent.js.
          if (event.type === 'reply') {
            setStreamingReply(event.text);
            // AS IT GROWS, not once it lands, and WHATEVER THE LENGTH.
            // The threshold was the bug: a short reply with a panel
            // attached stayed in the strip, where the panel is below the
            // fold and the strip does not scroll to it. Opening on the
            // first token means it is already open before there is
            // anything to read, rather than jumping open under someone.
          }

          /**
           * A LINE SHE CHOSE TO SAY BEFORE FINISHING. Its own bubble, and
           * spoken, while the rest of the turn is still running.
           *
           * Committed to history immediately rather than held like
           * `streamingReply`, because unlike a half-written sentence this
           * one is complete and final the moment it arrives — she has
           * already moved on to the work.
           */
          if (event.type === 'message' && event.text) {
            // Full entries, not bare strings: forms go into the same list
            // below and the two have to rebuild the same way.
            const entry = { role: 'assistant', content: event.text };
            setHistory((h) => [...h, entry]);
            if (!muted) tts.speak(speakableReply(event.text));
          }

          /**
           * A FILLABLE FORM, in the transcript.
           *
           * `content` is set as well as `form` because history is what
           * gets sent back to the model next turn, and it has to read as
           * something she said. Without it the next turn sees an assistant
           * message with no text and loses the thread.
           */
          if (event.type === 'form' && event.form) {
            const entry = {
              role: 'assistant',
              content: `[${event.form.title} form shown]`,
              form: event.form,
            };
            setHistory((h) => [...h, entry]);
          }

          /**
           * One deal, laid out. `content` is set so the next turn's
           * history reads as something she said.
           *
           * THE ROW ID IS IN THE TEXT, and it has to be. The next thing
           * the admin says is almost always the edit ("set the preset to
           * August"), and she can only skip a second search if the id is
           * somewhere she can read it. Without it she looked the same
           * person up again every time, which is a wasted round on the
           * commonest thing anyone does here.
           */
          if (event.type === 'card' && event.card) {
            noteTouched({
              row: event.card.id,
              person: event.card.name,
              group: event.card.groups
                ?.flatMap((g) => g.cells)
                ?.find((c) => c.label === 'Group')?.value,
              company: event.card.groups
                ?.flatMap((g) => g.cells)
                ?.find((c) => c.label === 'Company')?.value,
            });
            const entry = {
              role: 'assistant',
              content: `[showed ${event.card.name}'s deal #${event.card.id}]`,
              card: event.card,
            };
            setHistory((h) => [...h, entry]);
          }

          /**
           * THE EXPORT PANEL, which is a session rather than an answer.
           *
           * ONE AT A TIME. A second "give me the bank sheet" mid session is
           * them changing their mind, not opening a rival panel, so the
           * open one is replaced in place and its choices carry.
           *
           * The transcript line names the shape and the count, because that
           * is what the next turn reads: without it she has no idea what is
           * on their screen.
           */
          if (event.type === 'export-session' && event.session) {
            const { fileName, preview, columns = [], draft } = event.session;
            // THE COUNT, NOT THE LIST. It named all sixteen hidden columns,
            // which are DEFAULTS rather than choices, and she re-read that
            // paragraph on every round of every following turn.
            const cols = `${columns.length} columns`;
            const chosen = draft?.columnsTouched ? ', columns chosen by hand' : '';
            const line = `[export card: ${fileName}, ${preview?.rows ?? 0} rows, ${cols}${chosen}]`;
            // Kept so a reload brings it back. Building ends the session,
            // so that clears it instead.
            if (event.session.build) forgetExport(); else rememberExport(event.session);
            setHistory((h) => {
              const open = h.map((m) => Boolean(m.exportSession) && !m.cancelled).lastIndexOf(true);
              const entry = { role: 'assistant', content: line, exportSession: event.session };
              if (open === -1) return [...h, entry];
              const next = [...h];
              next[open] = { ...next[open], ...entry, paused: false };
              return next;
            });
          }

          /**
           * SHE PAUSED OR DROPPED IT, because they said so out loud.
           *
           * Both were buttons only, so "pause that" reached nothing and
           * she had to answer as though she had done it. Neither carries a
           * draft: one keeps what is on screen, the other removes it.
           */
          if (event.type === 'export-pause' || event.type === 'export-cancel') {
            const dropped = event.type === 'export-cancel';
            setHistory((h) => {
              const at = h.map((m) => Boolean(m.exportSession) && !m.cancelled).lastIndexOf(true);
              if (at === -1) return h;
              const next = [...h];
              // A PAUSE SURVIVES A RELOAD AND A CANCEL DOES NOT, which is
              // the same distinction on disk as on screen: one keeps, one
              // drops.
              if (dropped) {
                forgetExport();
                next[at] = { role: 'assistant', content: '[export cancelled]', cancelled: true };
              } else {
                rememberExport(next[at].exportSession, true);
                next[at] = { ...next[at], paused: true };
              }
              return next;
            });
          }

          /**
           * A FILTER RESULT, too many to draw as cards.
           *
           * The transcript line carries the ids, same reason the card one
           * does: "open the third one" and "the Nexus one" are both
           * answerable from the history without searching again.
           */
          /**
           * THE SHEET CHECK, drawn as its own turn.
           *
           * The transcript line carries the counts rather than every row:
           * next turn she has to be able to see WHAT was found without the
           * whole report going back through the model, which is the cost
           * this replaced.
           */
          if (event.type === 'check' && event.check) {
            const { check } = event;
            setHistory((h) => [...h, {
              role: 'assistant',
              content: check.total === 0
                ? `[sheet check: ${check.rows} rows, nothing to flag]`
                : `[sheet check: ${check.total} across ${check.rows} rows — ${
                  check.sections.map((s) => `${s.label.toLowerCase()} ${s.count}`).join(', ')
                }]`,
              check,
            }]);
          }

          if (event.type === 'list' && event.list) {
            // A COMPANY LIST names companies, not people or rows.
            const companies = event.list.kind === 'companies';
            if (!companies) {
              for (const r of event.list.rows) noteTouched({
                row: r.id, person: r.name, group: r.group, company: r.company,
              });
            }
            const entry = {
              role: 'assistant',
              content: companies
                ? `[listed ${event.list.rows.length} companies: ${event.list.rows.map((r) => r.name).join(', ')}]`
                : `[listed ${event.list.rows.length} deals: ${
                  event.list.rows.map((r) => `#${r.id} ${r.name}`).join(', ')
                }]`,
              list: event.list,
            };
            setHistory((h) => [...h, entry]);
          }

          /**
           * DICTATED VALUES, TYPED INTO THE OPEN FORM.
           *
           * Patches the most recent form rather than any particular one:
           * the admin is speaking at what is in front of them, and that is
           * always the last one shown.
           *
           * `version` is bumped so DealForm knows this is a NEW fill and
           * not a re-render. Without it the form seeds its state once on
           * mount and dictation would land in an object nothing reads.
           *
           * Nothing is submitted. The button stays theirs, which is the
           * only thing that catches a misheard amount before it becomes a
           * row somebody has to find and undo.
           */
          if (event.type === 'form-fill' && event.values) {
            setHistory((h) => {
              const at = h.map((m) => Boolean(m.form)).lastIndexOf(true);
              if (at === -1) return h;
              const prev = h[at];
              const fields = prev.form.fields.map((f) => (
                event.values[f.field] === undefined
                  ? f
                  : { ...f, value: String(event.values[f.field]) }
              ));
              const next = [...h];
              next[at] = {
                ...prev,
                form: { ...prev.form, fields, version: (prev.form.version ?? 0) + 1 },
              };
              return next;
            });
          }

          // What she is actually doing, while she does it. A turn that
          // spends three rounds looking things up showed nothing at all
          // until the very end. `say` is skipped: it is not work, and it
          // has already put its own words on screen.
          if (event.type === 'tool' && event.name !== 'say') {
            setWorkingText(toolPhrase(event.name, event.confirmed));
            // A new tool means the last one is finished with.
            setProgress(null);
          }

          /**
           * WHAT SHE IS WRITING, ROW BY ROW.
           *
           * Ninety six rows is several seconds of silence, and silence is
           * indistinguishable from a hang. Worse, if it fails half way
           * nobody can tell which half ran. This is what let the bulk cap
           * come up from sixty to the whole sheet.
           */
          if (event.type === 'progress') {
            setProgress({
              done: event.done, total: event.total, row: event.row,
              label: event.label, failed: event.failed ?? 0,
            });
          }
        },
      );
      // Signed out while this was in flight — drop it on the floor rather
      // than speaking a reply to someone who has already left.
      if (signedOutRef.current) return;
      setStreamingReply('');
      // The canonical reply replaces whatever the tokens built: the
      // cleaning pass runs over the whole text, so a mid-stream tail can
      // legitimately differ from the finished version.
      /**
       * APPEND, never rebuild from `nextHistory`.
       *
       * Everything that happened mid-turn — interim lines, a form, a card,
       * and any values dictated INTO that form — is already in state,
       * appended as it arrived. Rebuilding from `nextHistory`, which
       * predates all of it, restored the pre-fill copy of the form and
       * silently threw away what she had just typed into it.
       */
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: reply, claims },
        /**
         * AUTO MODE, AS ITS OWN TURN. After the answer, never inside it:
         * a change she just made and a question about how she works are
         * two different things, and one bubble carrying both would be read
         * as one. Raised by the runtime only after a confirmation the
         * admin actually gave. See autoConfirm.js.
         *
         * `content` is not decoration: the turn route refuses a history
         * entry without a string, and next turn she has to be able to see
         * that she asked this rather than inventing an answer to it.
         */
        ...(offer ? [{
          role: 'assistant',
          content: offer.kind === 'specialCase'
            ? `Should ${offer.who ?? 'this deal'} be paid this month anyway?`
            : 'Want me to stop asking before changes like that one?',
          offer,
        }] : []),
      ]);
      answered = true;
      // Still spoken in one piece. Speaking per token would stutter, and
      // the browser's own queue reorders short utterances.
      // WHAT IS ON SCREEN IS READ OUT, all of it, when the turn drew
      // something: the server builds `spoken` from the drawn data. See
      // api/v1/agent/screenReading.js. The bubble stays her short line.
      // Whatever is still being read from before stops for the new answer.
      tts.cancel?.();
      if (!muted) tts.speak(speakableReply(spoken ?? reply));
    } catch (err) {
      // Diane never shows a raw error — user's explicit call. A model
      // timeout, a missing key, a rate limit and a dropped connection all
      // read the same to whoever's using this: she didn't answer. So she
      // says so in character, in the transcript, instead of a red bar
      // that breaks the illusion and tells them nothing actionable. The
      // real reason still reaches the Logs page via the API's own
      // captureLog, which is where a developer should be looking anyway.
      // Still logged to the console. The in-character excuse is for the
      // admin; a developer looking at why she keeps "not catching that"
      // needs the actual status code and message, and having to go read
      // the server's Logs page to find out a request 502'd is friction
      // with no upside.
      console.error('[diane] agent turn failed:', err);
      // A failure may be the key or the credit running out: the page locks at once.
      recheckAi();
      if (signedOutRef.current) return;

      // A rate limit is the one failure with a genuinely useful message —
      // it says exactly how long until she works again. Replacing that
      // with "I didn't quite catch that" blamed the admin's wording for a
      // quota problem and left them retrying something that could not
      // possibly succeed. Everything else still gets the in-character
      // excuse, because "timeout" and "no key" aren't actionable here.
      // `failed` puts an "Ask again" button on the bubble. It is a flag for
      // the SCREEN and never travels: history is what goes back to the
      // model next turn, and it has no use for a UI affordance.
      if (err?.status === 429) {
        const message = err.message;
        setHistory([...nextHistory, { role: 'assistant', content: message, failed: true }]);
        if (!muted) tts.speak(message);
        return;
      }

      const excuse = RESTING_PHRASES[Math.floor(Math.random() * RESTING_PHRASES.length)];
      setHistory([...nextHistory, { role: 'assistant', content: excuse, failed: true }]);
      if (!muted) tts.speak(excuse);
    } finally {
      setProgress(null);
      setIsSending(false);
      // A rate limit counts as a turn she did not answer, same as a
      // timeout: from where the admin is sitting nothing came back. A turn
      // dropped because they SIGNED OUT is not counted at all — it was
      // abandoned, not failed.
      if (!signedOutRef.current) vitals.record(answered, performance.now() - startedAt);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  /**
   * ASK THE LAST QUESTION AGAIN, after a turn that came back with nothing.
   *
   * Her excuse is in character and deliberately vague about the cause, so
   * the only way forward was retyping the question. It is still in history,
   * two entries back: the failed answer, then the question that caused it.
   *
   * The failed pair is DROPPED first, or the retry sends a history where
   * she has already answered, and she reads that as the question being
   * settled.
   */
  function retryLastTurn() {
    if (isSending) return;
    const at = history.map((m) => Boolean(m.failed)).lastIndexOf(true);
    if (at < 1) return;
    const question = history[at - 1];
    if (question?.role !== 'user') return;
    // Everything before the question, which sendMessage then re-appends.
    sendMessage(question.content, history.slice(0, at - 1));
  }

  /**
   * The whole conversation as a plain text file.
   *
   * Text, not JSON: the point is to paste it into a bug report or read it
   * back, and JSON escaping makes a transcript harder to read for no gain.
   * The workspace is recorded in the header because the same question gets
   * a different answer in each one — a transcript without it is missing
   * the thing that decided which tools she had.
   */
  function downloadConversation() {
    const stamp = new Date();
    const lines = [
      `Diane conversation`,
      `Exported: ${stamp.toLocaleString()}`,
      `Workspace: ${context}`,
      `Messages: ${history.length}`,
      '',
      '='.repeat(60),
      '',
      ...history.map((m) => `${m.role === 'assistant' ? 'DIANE' : 'ADMIN'}:\n${m.content}\n`),
    ];

    // The BOM makes Windows text readers honour UTF-8 instead of decoding
    // punctuation as garbled characters.
    const blob = new Blob(['\uFEFF', lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    // Colons are illegal in Windows filenames, so the timestamp is
    // flattened rather than dropped: knowing which transcript is which
    // matters when several get sent in one report.
    const name = `diane-${context}-${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    // The shared saver, which also lets them pick the folder. This was the
    // third hand-rolled copy of the same anchor dance.
    saveBlob(blob, name);
  }

  /**
   * ===============================
   * * START AGAIN, on purpose
   * ===============================
   *
   * The transcript survives closing the orb and a page reload, both
   * deliberately, so until now the only way out of a conversation that had
   * gone somewhere unhelpful was to wait thirty minutes or close the tab.
   *
   * IT IS SAVED BEFORE IT IS CLEARED. The conversation happened; clearing
   * the screen is not unsaying it, and the log is what the search and the
   * summaries read. `endConversation` files it and starts a fresh id, so
   * what follows is not appended to the same row.
   *
   * A HALF BUILT EXPORT GOES WITH IT. Leaving the card behind would leave
   * a session whose questions and answers are no longer on screen, which
   * is why the confirm names it.
   */
  function resetConversation() {
    endConversation();
    forgetExport();
    setHistory([{ role: 'assistant', content: GREETING }]);
    setStreamingReply('');
    setProgress(null);
    setInput('');
    inputRef.current?.clear();
    // She may be mid sentence about something no longer on screen.
    tts.cancel?.();
    setConfirmingReset(false);
    inputRef.current?.focus();
  }

  /**
   * ===============================
   * * SHIFT+TAB TOGGLES AUTO MODE, anywhere in the overlay
   * ===============================
   * His call 2026-09-29, copying Claude Code, and the reason is the same:
   * the hand is already on the keyboard. Its own effect rather than a
   * branch inside the spacebar one below, because that is gated on the mic
   * being supported and this has nothing to do with the mic.
   *
   * SHIFT+TAB AND NOTHING ELSE. Plain Tab still moves focus, which is the
   * only way through this overlay without a mouse; taking it would make
   * the shortcut cost more than it saves.
   *
   * Held in a ref so the listener is bound once rather than torn down and
   * rebuilt on every keystroke, the same reason the spacebar one below
   * reaches for `toggleMicRef`.
   */
  const toggleAutoRef = useRef(() => {});
  toggleAutoRef.current = toggleAutoConfirm;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      e.preventDefault();
      toggleAutoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /**
   * Spacebar toggles the mic.
   *
   * The conflict this has to solve: the message box AUTO-FOCUSES whenever
   * Diane is idle (see the focus effect above), so the caret is almost
   * always sitting in it — and a plain "space toggles the mic" would mean
   * you could never type a space. The two features would cancel out.
   *
   * Resolved by what's in the box. Empty box, space means the mic; a space
   * there types nothing useful anyway. Any text at all, space is a space.
   * So it works exactly when you'd reach for it (about to speak) and never
   * gets in the way once you've started typing.
   *
   * Buttons are excluded too — space is how a keyboard user presses a
   * focused button, and stealing that would break the toolbar and the
   * quick commands.
   */
  useEffect(() => {
    if (!open || !stt.supported) return;

    const onKey = (e) => {
      /**
       * TYPING GOES TO THE BOX. Live 2026-09-30: a sentence typed while focus
       * sat on the page opened the mic at its first space, and the room was
       * sent as "Bye-". A character key outside any field moves focus to the
       * message box first, so the letter lands there and the space after it
       * is a space.
       */
      if (e.key?.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !isSending) {
        const at = document.activeElement;
        const typing = at?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(at?.tagName);
        if (!typing) inputRef.current?.focus();
        return;
      }
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // While she answers the box is disabled and focus falls to the page, so a
      // typed space opened the mic and recorded the room. 2026-09-25.
      if (isSending) return;

      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // The message box is a contentEditable div, so it's a containment
      // test rather than a tag check.
      if (el?.isContentEditable && input.trim().length > 0) return;

      e.preventDefault(); // or the page scrolls behind the overlay
      toggleMicRef.current();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, stt.supported, input, isSending]);

  function toggleMic() {
    if (stt.listening) {
      stt.stop();
      return;
    }
    // Cancel her first, then wait a beat before opening the mic.
    // speechSynthesis.cancel() is not instant in Chrome — audio already
    // handed to the OS can keep playing for a moment after it returns,
    // and anything still coming out of the speakers lands in the
    // recording as if the admin had said it.
    tts.cancel();
    setTimeout(() => stt.start(), 200);
  }

  // Held in a ref so the keydown effect doesn't have to list toggleMic as
  // a dependency — it's redeclared every render, which would tear down and
  // reattach the listener on every keystroke.
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;

  // She started speaking while the mic was open — bin the clip rather than
  // transcribe her own voice back into the conversation. In practice this
  // is a backstop: toggleMic cancels her before recording, and the
  // auto-restart is gated on tts.speaking. It exists because the failure
  // mode is silent and corrupts the history, so it's worth two guards.
  useEffect(() => {
    if (tts.speaking && stt.listening) stt.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.speaking, stt.listening]);

  // AN OPEN EXPORT PANEL IS A STATE, not a moment. It is the one time she
  // is building rather than answering, so the orb holds `building` through
  // her silences instead of settling back to idle between turns. Speaking
  // and listening still win: those are her actually doing something now.
  const buildingSheet = history.some((m) => m.exportSession && !m.paused && !m.cancelled);

  /** The newest live export owns the single preview projected over Diane. */
  const openCardIndex = history
    .map((m) => Boolean(m.exportSession) && !m.cancelled)
    .lastIndexOf(true);
  const openCard = openCardIndex >= 0 ? history[openCardIndex] : null;
  const cardStages = openCard?.exportSession?.stages ?? null;

  const mode = isSending || stt.transcribing
    ? 'thinking'
    : tts.speaking ? 'speaking'
      : stt.listening ? 'listening'
        : buildingSheet ? 'building' : 'idle';
  const level = tts.speaking ? tts.level : stt.listening ? stt.level : 0;
  // A live voice drives the orb; otherwise -1 lets it animate its own mode.
  orbLevelRef.current = tts.speaking || stt.listening ? level : -1;
  // What the orb shows, live: see orbStateFor.js.
  const orbState = orbStateFor({ mode, streaming: Boolean(streamingReply), failed: Boolean(history.at(-1)?.failed) });
  const busy = mode !== 'idle';

  /**
   * TWO LINES, TWO JOBS.
   *
   * `statusText` names the STATE, for the status panel: two or three words
   * that fit on one line and read the same way every time. The instruction
   * that used to be jammed into it ("press space or the mic when you're
   * done") belongs where the typing happens, so it is the placeholder.
   */
  const statusText = isSending
    ? 'Thinking'
    // Its own state, not "Thinking": the gap between releasing the mic and
    // the words appearing is a real second or two, and silence there reads
    // as the press having failed.
    : stt.transcribing ? 'Making out what you said'
      : tts.speaking ? 'Speaking'
        : stt.listening ? 'Listening'
          : buildingSheet ? 'Building your sheet'
            : 'All systems operational';

  const placeholder = stt.listening
    ? 'Listening. Press space or the mic when you are done'
    : 'Type, or press space to talk…';

  // THE CHOSEN THEME, in its command center variant. The provider colours what
  // paints in code; the diane-* classes follow the theme's variables.
  const { theme } = useTheme();
  const commandCenter = useMemo(() => commandCenterOf(dianeOf(theme)), [theme]);
  const tint = (alpha) => tintOf(alpha, commandCenter.signal);
  return (
    // Diane's command center, in the chosen theme.
    //
    // Hidden with CSS rather than unmounted when closed: that's what keeps
    // the orb's WebGL context alive across a close/reopen instead of
    // rebuilding the whole scene each time. `active={open}` is what stops
    // it DRAWING behind the hidden layer.
    <DianePaletteProvider value={commandCenter}>
    <div
      className={`fixed inset-0 z-30 flex-col bg-diane-void ${open ? 'flex' : 'hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Diane"
    >
      {/* Grid, scanlines and vignette. One static layer, no per-frame cost,
          and the same one the login and boot screens stand on. */}
      <DianeEnvironment />

      {/* ---- header ---------------------------------------------------- */}
      {/* Padding matches the body's on both edges, so the brand sits on the
          same line as the telemetry column under it and Go to portal on the
          same line as the conversation panel. */}
      <header className="relative z-30 shrink-0 flex items-start justify-between gap-3 py-4 px-3 sm:px-4 lg:px-5">
        <div className="flex items-center gap-3">
          <span className="hidden sm:flex w-11 h-11 items-center justify-center rounded-lg border border-diane-line/40 text-diane-signal shrink-0">
            <WaveformIcon width={20} height={20} />
          </span>
          <div>
            <h2
              // The orb's sweep in the letters, signal into accent.
              className="text-2xl sm:text-3xl font-bold tracking-[0.22em] leading-none m-0 bg-clip-text text-transparent bg-gradient-to-r from-diane-signal to-diane-accent"
              style={{ filter: `drop-shadow(0 0 18px ${tint(0.35)})` }}
            >
              DIANE
            </h2>
            <p className="hidden sm:block text-[0.58rem] tracking-[0.26em] text-diane-dim uppercase mt-2">
              AI Agent · Command Center
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <HeaderButton
            onClick={() => setMuted((m) => !m)}
            label={muted ? 'Unmute Diane' : 'Mute Diane'}
            active={!muted}
          >
            {muted ? <SpeakerMuteIcon width={17} height={17} /> : <WaveformIcon width={17} height={17} />}
          </HeaderButton>

          {/* The way out, and the only control that says so in words. It
              was a bare expand icon labelled "Close Diane", which left
              nothing on screen saying the CRM is behind here at all. */}
          <button
            type="button"
            onClick={onClose}
            title="Go to portal"
            className="inline-flex items-center gap-2 h-10 min-h-0 rounded-lg px-3 sm:px-4 py-0 text-[0.68rem] font-bold tracking-[0.16em] uppercase border !border-diane-signal/55 !bg-transparent !text-diane-signal hover:!bg-diane-signal/10 hover:!border-diane-signal transition-colors"
          >
            <ExpandIcon width={15} height={15} />
            <span className="hidden sm:inline">Go to portal</span>
          </button>
        </div>
      </header>

      {/*
        ---- body: her and her command bar | conversation ------------------

        A GRID, not nested flex rows, and that is the whole reason the panel
        can run to the bottom of the screen while the command bar stops at
        her half. Two columns that have to reach different depths cannot be
        one flex row with a footer under it, and the alternative was padding
        the bar by hand to the panel's width: two numbers that have to agree,
        which is the thing this layout already threw out once.

        Below lg it becomes THREE rows in one column: her, the conversation,
        the bar. She sizes to her own content there and the conversation
        takes what is left, so the panel is on screen at every width.

        ONE MARGIN, all four edges, and it is tight. Everything here is a
        readout or a panel that wants the room, and the wider gutter it was
        keeping held nothing once the trust rail went.
      */}
      <div className="relative z-20 flex-1 min-h-0 grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 lg:gap-x-5 lg:gap-y-0 px-3 sm:px-4 lg:px-5 pb-3 sm:pb-4 lg:grid-cols-[minmax(0,1fr)_25rem] xl:grid-cols-[minmax(0,1fr)_30rem] 2xl:grid-cols-[minmax(0,1fr)_36rem] lg:grid-rows-[minmax(0,1fr)_auto]">
        {/* The stage. She is centred in whatever is left after the panel,
            which is a fixed column, so she never moves once she is drawn. */}
        <section className="relative row-start-1 col-start-1 min-h-0 flex items-stretch justify-start gap-4 xl:gap-6">
          {/*
            THE TELEMETRY COLUMN TAKES ITS OWN SPACE, it does not float over
            her. Absolutely positioned in the orb's margin was the first
            attempt and at 1280px there is no margin: the panel landed on
            top of the particle field. A real column narrows the orb
            instead, which is the honest trade.

            Hard against the left edge, and the plate centres in what is
            left of the row rather than the two being centred together.
          */}
          <div className="hidden xl:flex w-40 shrink-0 flex-col justify-center">
            <OrbVitals mode={mode} level={level} vitals={vitals} active={open} />
          </div>

          <div className="flex-1 min-w-0 flex justify-center">
          {/* One max width for her and the plate under her, so the rings
              stay wider than the orb at every screen size instead of the
              two being capped separately and drifting apart. */}
          <div
            className="relative w-full flex flex-col items-center justify-center"
            style={{ maxWidth: 'min(100%, 720px)' }}
          >
            {/* The orb's slot is a FIXED size in vh, not `flex-1`: her size
                should not be a side effect of how much has been said. */}
            <div
              ref={orbSlotRef}
              className="relative w-full"
              // The plinth's space is the orb's now, his call 2026-09-27.
              style={{ height: 'clamp(240px, 62vh, 700px)', maxWidth: 'min(100%, 720px)' }}
            >
              <OrbHud>
                <Suspense fallback={<OrbPlaceholder />}>
                  {/* Paused by itself while hidden. Never takes a click: its canvas overhangs.
                      CENTRED BY ITS MIDDLE, not a grid: a grid sized its track to the
                      oversized canvas and pushed it right and down. */}
                  <div className="pointer-events-none relative h-full w-full">
                    {orbSize > 0 && (
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                        <ParticlesOrb
                          state={orbState}
                          size={orbSize}
                          levelRef={orbLevelRef}
                          colorFrom={commandCenter.signal}
                          colorTo={commandCenter.accent}
                          label="Diane"
                        />
                      </div>
                    )}
                  </div>
                </Suspense>
              </OrbHud>

              {/*
                ONE PROJECTED SURFACE. The preview used to live in the
                transcript while its choices were rendered again in the
                conversation footer. Those two copies could overlap and
                disagree. The active export now floats over the orb as one
                glass card; the transcript keeps only a small reference.
              */}
              {openCard && !openCard.paused && (
                <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center sm:inset-5">
                  <div className="pointer-events-auto max-h-full w-full max-w-[34rem]">
                    <ExportSession
                      overlay
                      session={openCard.exportSession}
                      busy={isSending}
                      onBuild={buildExport}
                      onSay={sendMessage}
                      onPause={() => pauseExport(openCardIndex, true)}
                      onCancel={() => cancelExport(openCardIndex)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/*
              The projector plate. Static SVG, pulled up under her so the
              beam starts inside the field rather than below it.

              THE WIDTH DRIVES IT, not a height in vh. `preserveAspectRatio`
              letterboxes to whichever axis is tighter, so a fixed height
              left the rings at half the width they had room for and the
              beam a thread. `h-auto` takes the height from the viewBox, and
              the pull up is a percentage, which resolves against the WIDTH,
              so the overlap scales with the plate instead of drifting.

              The cap is for a short window, where the plate would otherwise
              push the command bar off the bottom.
            */}
            {/* The same readout, where the bar is too narrow for the box. */}
            <div className="sm:hidden mt-1">
              <StatusReadout compact text={statusText} busy={busy} />
            </div>
          </div>
          </div>
        </section>

        {/*
          ---- the conversation -----------------------------------------

          AN ORDINARY COLUMN, not a fixed drawer. It used to be
          `position: fixed` with a matching padding on the column beside it,
          which is two numbers that have to agree and were written twice.
          Below lg it covers the stage instead, because a 26rem panel and an
          orb do not both fit in 900px.

          The INPUT is not in here. It spans the foot of the whole screen,
          so opening and closing this can never remount the editor and lose
          what was half typed.
        */}
        {/* FULL HEIGHT, both rows, so it runs to the bottom of the screen
            while her command bar stops at her half. Below lg it is the
            middle row and takes whatever she and the bar leave.

            ALWAYS ON SCREEN. It was collapsible, which meant the product of
            this page had a control that hid it, and a transcript rendered
            twice so a closed drawer still had a strip under the orb. */}
        {/*
          ===============================
          * BELOW lg IT COVERS HER, RATHER THAN QUEUING UNDER HER
          ===============================
          It was the middle ROW, so the stage above it took 38vh of orb and
          26vh of plate and the transcript got whatever was left. On a short
          window that was one clipped line. Reported 2026-09-17.

          Squeezing the orb was the first fix and the wrong one: it made her
          small on every phone to buy a few lines. His call is that the
          transcript takes the screen and SHE SHOWS THROUGH IT, so it spans
          both rows and the panel is translucent.

          `backdrop-blur` is not decoration. The particle field moves, and
          unblurred text over it is unreadable while she is thinking.
        */}
        <aside className="row-start-1 row-span-2 col-start-1 z-10 lg:row-start-1 lg:col-start-2 lg:row-span-2 lg:z-auto min-h-0 flex flex-col overflow-hidden rounded-lg border border-diane-line/35 bg-diane-panel/55 backdrop-blur-sm lg:bg-diane-panel/70 lg:backdrop-blur-none">
          <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0 border-b border-diane-line/30">
            <PanelLabel>Conversation</PanelLabel>
            <div className="flex items-center gap-1">
              {/* TOP RIGHT, because the header is the one part of the panel
                  that cannot scroll. On the card alone it disappeared three
                  questions in, and nothing said an export was half built. */}
              {openCard && cardStages && (
                <SessionTracker stages={cardStages} paused={Boolean(openCard.paused)} />
              )}
              {/* Developer mode only: this is for reporting exactly what she
                  was asked and exactly what she said back. */}
              {devMode && (
                <button
                  type="button"
                  onClick={downloadConversation}
                  disabled={history.length === 0}
                  className="btn-quiet w-8 h-8 min-h-0 p-0 border-0 bg-transparent text-diane-dim/60 hover:text-diane-signal disabled:opacity-30"
                  aria-label="Download the whole conversation"
                  title="Download the whole conversation"
                >
                  <DownloadIcon width={16} height={16} />
                </button>
              )}
              {/* Not developer only: the transcript survives a close and a
                  reload on purpose, so without this the only way out of a
                  conversation gone sideways was to wait thirty minutes. */}
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                disabled={isSending || history.length <= 1}
                className="btn-quiet w-8 h-8 min-h-0 p-0 border-0 bg-transparent text-diane-dim/60 hover:text-diane-signal disabled:opacity-30"
                aria-label="Start a new conversation"
                title="Start a new conversation"
              >
                <ResetIcon width={16} height={16} />
              </button>
            </div>
          </div>

          {/* `relative` so the jump pill can sit over the foot of the
              transcript rather than taking a row of its own. */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={drawerScrollRef}
              className={`agent-scroll h-full overflow-y-auto flex flex-col gap-2 px-4 py-4 ${buildingSheet ? 'session-alive' : ''}`}
            >
              <Messages
                history={history}
                isSending={isSending}
                workingText={workingText}
                progress={progress}
                streamingReply={streamingReply}
                onFormSubmit={submitForm}
                onCellEdit={editCell}
                onExportPause={pauseExport}
                onOpenDeal={setOpenDeal}
                onRetry={retryLastTurn}
                onOffer={answerOffer}
              />
            </div>

            {/* One mark, at the bottom centre, only while there is
                something below. It replaced both the scrollbar and a
                separate "jump to latest" pill: they were the same signal
                twice. */}
            <ScrollMore targetRef={drawerScrollRef} label="Latest" watch={history.length} />
          </div>

          {/* Build progress stays beside the conversation while the live
              preview and its choices occupy the orb stage. */}
          <div className="shrink-0 px-4 pb-4 space-y-2">
            {/* THE FILE BEING MADE, wherever the card has got to. */}
            {buildProgress && (
              <div className="border border-diane-line/35 bg-diane-sunken/80 px-2.5 py-2">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-diane-signal">
                    {buildProgress.saving ? 'Saving' : 'Building'} {buildProgress.fileName}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-white/40">
                    {buildProgress.saving ? 'choose where' : `${buildProgress.pct}%`}
                  </span>
                </div>
                <span className="block h-1 w-full overflow-hidden rounded-full bg-white/10">
                  {/* While SAVING there is no percentage to show: the
                      dialogue is open and the write happens after. A full
                      bar that keeps moving says working, not finished. */}
                  <span
                    className="block h-full rounded-full bg-diane-signal tracker-live transition-[width] duration-300 ease-out"
                    style={{ width: buildProgress.saving ? '100%' : `${buildProgress.pct}%` }}
                  />
                </span>
              </div>
            )}

          </div>
        </aside>

        {/*
          ---- her command bar -------------------------------------------
          ROW 2, COLUMN 2: under her, and only as wide as she is, which is
          what leaves the panel free to run to the bottom of the screen.

          It is outside that panel, so opening and closing the conversation
          can never remount the editor and lose what was half typed.
        */}
        <div className="row-start-3 col-start-1 lg:row-start-2 flex flex-col gap-2">
          {/* PAUSED, so there is nothing to answer. One tap back to the
              card, which is where resuming and cancelling live. */}
          {openCard && openCard.paused && (
            <button
              type="button"
              onClick={() => pauseExport(openCardIndex, false)}
              className="session-pill self-center flex items-center gap-2 rounded-full border border-diane-signal/40 bg-diane-sunken px-3 py-1.5 text-[11px] text-diane-signal hover:bg-diane-signal/10"
            >
              Export paused
            </button>
          )}

        <div className="flex items-end gap-3 lg:gap-4">
          {/* The status box, beside the bar rather than out in the margin.
              It is the same component as the one line under her, so the two
              can never say different things. */}
          <div className="hidden sm:block w-44 shrink-0">
            <StatusReadout text={statusText} busy={busy} />
          </div>

          <div className="flex-1 min-w-0">
            {/* THE MODE, ABOVE THE BOX IT APPLIES TO. A permission mode you
                cannot see is one you forget you are in, and this one decides
                whether a change to somebody's pay lands on a sentence or on
                a sentence plus a yes. See AutoModeChip. */}
            <AutoModeChip
              on={autoConfirm}
              busy={updateSettings.isPending}
              onToggle={() => toggleAutoConfirm()}
            />
          <form onSubmit={handleSubmit}>
            {/* RichInput owns both rows and the pill's own outline: the
                formatting toolbar has to sit OUTSIDE that outline, and only
                whatever draws it can say where the edge is. */}
            <RichInput
              ref={inputRef}
              onChange={setInput}
              onSubmit={() => sendMessage(input)}
              disabled={isSending}
              placeholder={placeholder}
              maxHeight="6rem"
              before={
                stt.supported && (
                  <button
                    type="button"
                    onClick={toggleMic}
                    className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 min-h-0 p-0 ${
                      stt.listening
                        ? 'border-diane-signal text-diane-void bg-diane-signal'
                        : 'border-diane-line/60 text-diane-signal bg-transparent hover:border-diane-signal'
                    }`}
                    style={stt.listening ? { boxShadow: `0 0 18px ${tint(0.5)}` } : undefined}
                    aria-label={stt.listening ? 'Stop listening' : 'Talk to Diane'}
                    aria-pressed={stt.listening}
                    title={stt.listening ? 'Stop listening (space)' : 'Talk to Diane (space)'}
                  >
                    <MicIcon width={19} height={19} />
                  </button>
                )
              }
              after={
                <>
                  {/* NO LEVEL METER AND NO KEY HINT. The meter said what the
                      vitals panel's SIGNAL and the orb itself already say,
                      and the hint was a permanent line of text inside a box
                      you type in. */}
                  <button
                    type="submit"
                    className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center border min-h-0 p-0 transition-colors disabled:opacity-30 border-diane-signal/50 bg-transparent text-diane-signal hover:bg-diane-signal/10"
                    disabled={isSending || !input.trim()}
                    aria-label="Send"
                  >
                    <SendIcon width={17} height={17} />
                  </button>
                </>
              }
            />
          </form>
          </div>
        </div>

          {/* BELOW the bar, in a slot that is always there. It used to
              appear only when set, which meant a transient mic error shoved
              the whole conversation up a line and then dropped it back. */}
          <p className="text-xs text-diane-dim/40 min-h-4 leading-4 px-1" aria-live="polite">
            {micHint ? `${micHint} Typing still works.` : ''}
          </p>
        </div>
      </div>

      {/* One deal, opened from a chip in her list. It fetches its own card
          rather than asking her to look the row up again. */}
      {openDeal && <DealModal row={openDeal} onClose={() => setOpenDeal(null)} />}

      {/* NAMES WHAT SURVIVES, because "reset" alone reads as though the
          conversation is being deleted from the CRM, and it is not. */}
      {confirmingReset && (
        <ConfirmDialog
          title="Start a new conversation"
          subject={`This clears ${history.length - 1} ${history.length === 2 ? 'message' : 'messages'} off the screen.`}
          detail={[
            'The conversation is SAVED first, so it stays searchable in the log. This clears the screen, not the record.',
            openCard
              ? 'The half built export goes with it, and nothing has been generated. You would start that again.'
              : 'Nothing on the master sheet changes.',
          ]}
          confirmLabel="Start again"
          icon={<ResetIcon width={20} height={20} />}
          onConfirm={resetConversation}
          onCancel={() => setConfirmingReset(false)}
        />
      )}
    </div>
    </DianePaletteProvider>
  );
}
