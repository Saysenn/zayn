import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DianePaletteProvider, useDianePalette } from './DianePalette';
import { JARVIS_HUD } from '../../configs/dianeTheme';
import DianeEnvironment from './DianeEnvironment';
import { useOpenaiSpeech } from './useOpenaiSpeech';
import { useVoiceInput } from './useVoiceInput';
import {
  BRIEFING_GOES_TO, NO, heardYes, ASK, nextGreeting, sectionSegments, heardTopic, groupCounts, cardEntries,
  reconcile, changeCounts, closingLine, ROW_STATUS, TOPIC_WORDS, DETAIL_KEYS, TOPIC_LABEL, HUD_LABEL, owedText,
} from './briefingAnswer';
import { ORB_STATE } from './particlesOrb/orbState';
import { useOrbSlot } from './particlesOrb/useOrbSlot';
import { useSocketEvent } from '../../hooks/useSocket';
import { apiService } from '../../configs/api.config';
import { formatMoney } from '../../helpers/formatMoney';

// THE PARTICLES ORB, the command center's, his call 2026-09-28. It replaced
// the shader orb here. The loading screen keeps its particle field.
const ParticlesOrb = lazy(() => import('./particlesOrb/ParticlesOrb'));
// Its share of the screen's shorter side, so the words sit inside the sphere.
const ORB_FILL = 0.95;

/**
 * ***************************************************
 * * WHAT SHE SAYS WHEN YOU SIGN IN
 * ***************************************************
 *
 * NOT THE OLD GREETING SCREEN. That one made you CHOOSE a destination and
 * was removed on purpose; a sign-in still lands in the CRM.
 *
 * SHE READS THE CARD, his call 2026-09-28. Each topic
 * is one card in a Z stack: its count line, then she reads the card entry by
 * entry as each one lights. The parts are queued AHEAD, the command center's
 * trick: the next ones synthesise while this one plays, so there is no gap.
 *
 * THE SHEET CAN MOVE WHILE SHE TALKS. A live change refetches the briefing
 * and reconciles it in place: nothing read is removed, a sorted row is ticked,
 * a new one is added, and her closing line says how many. See reconcile().
 *
 * VOICE OR A CLICK for the answer: the ask card carries a button per
 * topic and Later, so a denied microphone loses nothing.
 */

// She waits this long after asking before giving up on an answer.
const ANSWER_WINDOW_MS = 12000;
const FADE_MS = 600;
// Typing pace. The audio is the clock; a line typed early just waits for her.
const TYPE_MS_PER_CHAR = 28;
// Parts queued ahead of the one she is saying, all synthesising at once. The voice
// service takes 3 to 9 seconds a request, so four still left cards holding. 2026-09-28.
const LOOKAHEAD = 12;
// With no voice at all, a part lasts as long as it takes to read.
const SILENT_PAUSE_MS = 700;
// Each row in a batch lands this long after the one before it.
const ROW_STAGGER_MS = 40;
// Past this many the rest land together, so a long breakdown is fast, never a queue.
const ROW_STAGGER_CAP = 8;

// THE STACK: each card further back is higher, smaller and fainter, and past
// STACK_DEPTH it is gone. Tuned by eye on the welcome page, 2026-09-28.
const STACK_DEPTH = 3;
const STACK_STEP_Y = 34;
const STACK_STEP_Z = 140;
const STACK_FADE = 0.3;
const STACK_PERSPECTIVE_PX = 1200;
const STACK_EDGE_FRONT = 0.34;
const STACK_EDGE_BACK = 0.16;

/** One line, revealed a character at a time while she says it. Nothing yet while pending. */
function useTyped(text, active, pending) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (pending) { setShown(0); return undefined; }
    if (!active) { setShown(text ? text.length : 0); return undefined; }
    setShown(0);
    const timer = setInterval(
      () => setShown((n) => (n >= text.length ? n : n + 1)),
      TYPE_MS_PER_CHAR,
    );
    return () => clearInterval(timer);
  }, [text, active, pending]);
  return shown;
}

/**
 * A spoken line. With `to` it is a button, because there is a page behind it.
 *
 * ITS FULL HEIGHT FROM THE START: the untyped rest is laid out, invisible, so a
 * card never grows as she speaks. His call 2026-09-28.
 */
function Line({ text, to, active, done, pending = false, onOpen }) {
  const palette = useDianePalette();
  const { tint } = palette;
  const shown = useTyped(text, active, pending);
  const body = (
    <>
      {text.slice(0, shown)}
      {/* The caret is the only thing that says she is still talking. Zero width, so nothing moves. */}
      {active && shown < text.length && (
        <span className="inline-block w-0 animate-pulse" style={{ color: palette.signal }}>|</span>
      )}
      <span aria-hidden="true" style={{ opacity: 0 }}>{text.slice(shown)}</span>
    </>
  );
  const look = 'block w-full px-0 py-1 text-center text-[13px] leading-relaxed transition-[color,text-shadow] duration-700 sm:text-sm';
  const colour = {
    // WHITE: these are the words she is actually saying.
    color: done ? palette.settled : palette.speech,
    textShadow: active ? `0 0 24px ${tint(0.5, palette.signal)}` : 'none',
  };
  if (!to) return <span className={look} style={colour}>{body}</span>;
  return (
    <button type="button" onClick={() => onOpen(to)} className={`${look} min-h-0 border-0 bg-transparent`} style={colour}>
      {body}
    </button>
  );
}

// Where an entry is in the read along: waiting its turn, being said, said.
const READ_STATE = Object.freeze({ WAITING: 'waiting', ACTIVE: 'active', DONE: 'done' });
// A waiting entry is quieter, so the eye follows her voice down the card.
const WAITING_OPACITY = 0.45;

/** How an entry looks in the read along. Colour and glow only: nothing moves. */
function litStyle(state, colour) {
  return {
    color: colour,
    opacity: state === READ_STATE.WAITING ? WAITING_OPACITY : 1,
    textShadow: state === READ_STATE.ACTIVE ? `0 0 14px ${colour}` : 'none',
    transition: 'opacity 0.5s ease, text-shadow 0.5s ease, color 0.5s ease',
  };
}

/** Every company with its count: "Workforce 23", wrapping. Exact, never cut. */
function Breakdown({ entries, lit }) {
  const palette = useDianePalette();
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] leading-relaxed">
      {entries.map((e, order) => {
        const state = lit(e.id);
        return (
          <span
            key={e.id}
            className="briefing-row-in whitespace-nowrap"
            style={{ animationDelay: `${Math.min(order, ROW_STAGGER_CAP) * ROW_STAGGER_MS}ms` }}
          >
            <span style={litStyle(state, state === READ_STATE.ACTIVE ? palette.speech : palette.settled)}>{e.name}</span>
            <span className="ml-1.5 font-semibold tabular-nums" style={litStyle(state, palette.signal)}>{e.count}</span>
          </span>
        );
      })}
    </div>
  );
}

/** One deal on a data check, with the amounts that make it one. */
function DetailRow({ row, keyName, order, state = READ_STATE.DONE }) {
  const palette = useDianePalette();
  const { tint } = palette;
  const sorted = row.status === ROW_STATUS.SORTED;
  // a person with several unpaid deals: "3 deals" where one company would go
  const where = [row.company ?? (row.deals > 1 ? `${row.deals} deals` : null), row.group].filter(Boolean).join(' · ');
  const figure = keyName === 'payableOver'
    ? `${formatMoney(row.amount, row.currency)} of ${formatMoney(row.monthly, row.currency)} monthly`
    : keyName === 'unpaid' ? owedText(row, formatMoney) : formatMoney(row.amount, row.currency);
  return (
    <div
      className="briefing-row-in flex items-baseline gap-3 px-1 py-0.5 text-[13px]"
      style={{ animationDelay: `${Math.min(order, ROW_STAGGER_CAP) * ROW_STAGGER_MS}ms`, opacity: sorted ? 0.4 : 1 }}
    >
      <span className="min-w-0 flex-1 truncate" style={litStyle(state, palette.speech)}>
        {sorted && <span style={{ color: palette.signal }}>✓ </span>}
        {row.person}
        <span className="ml-2" style={{ color: tint(0.75, palette.dim) }}>{where}</span>
      </span>
      <span className="shrink-0 tabular-nums" style={litStyle(state, palette.signal)}>{figure}</span>
    </div>
  );
}

// ===============================
// * THE HUD, "like JARVIS", his call 2026-09-28
// ===============================
// Monospace for the readouts, so they read as instruments, not prose.
const HUD_FONT = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
// Cut corners, top left and bottom right, the HUD panel's silhouette.
const HUD_CUT_PX = 14;
const HUD_CHAMFER = `polygon(${HUD_CUT_PX}px 0, 100% 0, 100% calc(100% - ${HUD_CUT_PX}px), calc(100% - ${HUD_CUT_PX}px) 100%, 0 100%, 0 ${HUD_CUT_PX}px)`;
// The rings sit just outside the orb.
const HUD_RING_FILL = 1.12;
const HUD_BRACKET_PX = 12;

const pad = (n) => String(n).padStart(2, '0');

/** Four corner brackets just outside a panel, brighter on the front one. */
// Longhand only: mixing `borderColor` with the `border*` shorthand made React
// warn and the shorthand reset the colour, so `colour` never applied.
function Brackets({ colour }) {
  const arm = {
    position: 'absolute', width: HUD_BRACKET_PX, height: HUD_BRACKET_PX,
    borderStyle: 'solid', borderColor: colour, borderWidth: 0,
  };
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -inset-1.5 transition-colors duration-1000">
      <span style={{ ...arm, left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 }} />
      <span style={{ ...arm, right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 }} />
      <span style={{ ...arm, left: 0, bottom: 0, borderLeftWidth: 1, borderBottomWidth: 1 }} />
      <span style={{ ...arm, right: 0, bottom: 0, borderRightWidth: 1, borderBottomWidth: 1 }} />
    </span>
  );
}

/**
 * THE ANSWER, CLICKABLE. "Which one first?" had only a voice answer, so a
 * browser without a mic had no way to pick. One button per topic on screen,
 * the first one primary (it is what "yes" picks), and Later to leave.
 */
function AskChoices({ keys, onPick }) {
  const { tint, signal, hot, dim, speech } = useDianePalette();
  const base = 'min-h-0 px-3 py-1.5 text-[10px] uppercase tracking-[0.25em] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-offset-0';
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label="Which one first?">
      {keys.map((key, i) => {
        const primary = i === 0;
        const rest = {
          color: primary ? hot : speech,
          background: primary ? tint(0.2, signal) : 'transparent',
          borderColor: primary ? signal : tint(0.35, signal),
        };
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(BRIEFING_GOES_TO[key])}
            className={`${base} border`}
            style={{ fontFamily: HUD_FONT, ...rest, '--tw-ring-color': signal }}
            onMouseEnter={(e) => { e.currentTarget.style.background = tint(primary ? 0.32 : 0.12, signal); }}
            onMouseLeave={(e) => { e.currentTarget.style.background = rest.background; }}
          >
            {TOPIC_LABEL[key] ?? key}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`${base} border border-transparent bg-transparent`}
        style={{ fontFamily: HUD_FONT, color: tint(0.75, dim), '--tw-ring-color': signal }}
        onMouseEnter={(e) => { e.currentTarget.style.color = hot; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = tint(0.75, dim); }}
      >
        Later
      </button>
    </div>
  );
}

/**
 * Thin rotating rings around the orb. EACH RING IS ITS OWN LAYER, turned whole:
 * turning a circle inside one SVG redrew the 800px drawing every frame, 20 fps.
 */
function HudRings({ size }) {
  const { tint, signal } = useDianePalette();
  const ring = (className, props) => (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={`absolute left-0 top-0 ${className}`}
    >
      <circle cx="50" cy="50" {...props} />
    </svg>
  );
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: size, height: size }}>
      {ring('', { r: 49.5, stroke: tint(0.12, signal), strokeWidth: 0.15 })}
      {ring('hud-spin', { r: 48, stroke: tint(0.35, signal), strokeWidth: 0.6, strokeDasharray: '0.3 1.9' })}
      {ring('hud-spin-rev', { r: 45.5, stroke: tint(0.22, signal), strokeWidth: 0.25, strokeDasharray: '18 5 3 5' })}
    </div>
  );
}

/** Live time and date, top right. Its own state, so its tick redraws only itself. */
function HudClock() {
  const { tint, signal, dim } = useDianePalette();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="pointer-events-none absolute right-[4vw] top-[4vh] text-right text-[10px] uppercase tracking-[0.3em]" style={{ fontFamily: HUD_FONT }}>
      <div className="tabular-nums" style={{ color: tint(0.85, signal) }}>{now.toLocaleTimeString('en-GB')}</div>
      <div className="mt-1" style={{ color: tint(0.55, dim) }}>
        {now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
      </div>
    </div>
  );
}


/** The welcome page, in the JARVIS HUD palette whatever the theme. See JARVIS_HUD. */
export default function DianeBriefing(props) {
  return (
    <DianePaletteProvider value={JARVIS_HUD}>
      <BriefingScreen {...props} />
    </DianePaletteProvider>
  );
}

function BriefingScreen({ items: initialItems, greeting: madeAhead, onDone }) {
  const palette = useDianePalette();
  const { tint } = palette;
  const navigate = useNavigate();
  const tts = useOpenaiSpeech();
  const [leaving, setLeaving] = useState(false);
  const [asking, setAsking] = useState(false);
  // The loading screen's pick when it made the audio ahead; otherwise picked now.
  const [greeting] = useState(() => madeAhead ?? nextGreeting());
  // LIVE: reconciled against the sheet while she talks. See reconcile().
  const [items, setItems] = useState(() => initialItems ?? []);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // THE SCRIPT, built a section at a time. A section's rows are fixed when its
  // count line is queued, so a batch never shifts under her voice.
  const segmentsRef = useRef([{ kind: 'greet', text: greeting }]);
  const [segments, setSegments] = useState(segmentsRef.current);
  const expandedRef = useRef(0);
  const endedRef = useRef(false);
  // How many parts she has FINISHED. The part at this index is being said.
  const [spoken, setSpoken] = useState(0);
  const queuedRef = useRef(0);
  const genRef = useRef(0);
  const startedRef = useRef(false);

  const leave = useRef(null);
  leave.current = (to) => {
    if (leaving) return;
    setLeaving(true);
    genRef.current += 1;
    tts.cancel();
    if (to) navigate(to);
    setTimeout(onDone, FADE_MS);
  };

  /** Adds the next section, or the closing and the question. False when done. */
  const expand = useCallback(() => {
    const list = itemsRef.current;
    const next = list[expandedRef.current];
    let added;
    if (next) {
      expandedRef.current += 1;
      const live = { ...next, rows: next.rows.filter((r) => r.status !== ROW_STATUS.SORTED) };
      added = sectionSegments(live);
    } else if (!endedRef.current) {
      endedRef.current = true;
      const closing = closingLine(changeCounts(list));
      added = [...(closing ? [{ kind: 'closing', text: closing }] : []), { kind: 'ask', text: ASK }];
    } else {
      return false;
    }
    segmentsRef.current = [...segmentsRef.current, ...added];
    setSegments(segmentsRef.current);
    return true;
  }, []);

  const say = useCallback((text) => (tts.available
    ? tts.speak(text)
    : new Promise((resolve) => { setTimeout(resolve, text.length * TYPE_MS_PER_CHAR + SILENT_PAUSE_MS); })), [tts]);

  /** Queues parts up to `upto`, each one advancing the screen as it finishes. */
  const queueUpTo = useRef(null);
  queueUpTo.current = (upto) => {
    while (queuedRef.current < upto) {
      if (queuedRef.current >= segmentsRef.current.length && !expand()) break;
      const index = queuedRef.current;
      const segment = segmentsRef.current[index];
      const gen = genRef.current;
      queuedRef.current += 1;
      say(segment.text).then(() => {
        if (gen !== genRef.current) return;
        setSpoken(index + 1);
        // The LAST part is the question, so finishing it opens the mic.
        if (segment.kind === 'ask') setAsking(true);
        queueUpTo.current(index + 1 + LOOKAHEAD);
      });
    }
  };

  // SPOKEN ONCE, even under StrictMode, and only once the voice is known.
  useEffect(() => {
    if (startedRef.current || tts.available === null || !initialItems?.length) return;
    startedRef.current = true;
    queueUpTo.current(1 + LOOKAHEAD);
  }, [tts.available, initialItems]);

  /** "Next": the right arrow jumps to the next topic, the rows before it shown. */
  const nextTopic = useRef(null);
  nextTopic.current = () => {
    if (asking || leaving) return;
    genRef.current += 1;
    tts.cancel();
    let target = segmentsRef.current.findIndex((s, i) => i > spoken && (s.kind === 'head' || s.kind === 'ask' || s.kind === 'closing'));
    while (target === -1 && expand()) {
      target = segmentsRef.current.findIndex((s, i) => i > spoken && (s.kind === 'head' || s.kind === 'ask' || s.kind === 'closing'));
    }
    if (target === -1) return;
    setSpoken(target);
    queuedRef.current = target;
    queueUpTo.current(target + 1 + LOOKAHEAD);
  };

  // THE SHEET MOVED: refetch, reconcile in place. Nothing read is removed.
  useSocketEvent('master-sheet:changed', () => {
    if (leaving) return;
    apiService.briefing.get()
      .then((res) => setItems((shown) => reconcile(shown, res?.items ?? [])))
      .catch(() => {});
  });

  /**
   * BACK TO AN EARLIER CARD, his call 2026-09-28. `focus` is the card brought
   * to the front, null while following her. She keeps talking: going back is
   * a look, and forward past the newest card returns to her.
   */
  const [focus, setFocus] = useState(null);
  const cardCountRef = useRef(0);
  const back = useRef(null);
  back.current = () => setFocus((f) => Math.max(0, (f ?? cardCountRef.current - 1) - 1));
  const forward = useRef(null);
  forward.current = () => {
    if (focus === null) { nextTopic.current(); return; }
    setFocus(focus + 1 >= cardCountRef.current - 1 ? null : focus + 1);
  };

  // ESC IS SKIP, the arrows are BACK and NEXT. Bound once through refs.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') leave.current(null);
      if (e.key === 'ArrowLeft') back.current();
      if (e.key === 'ArrowRight') forward.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // THE PAGE BEHIND DOES NOT SCROLL while she talks: its scrollbar showed at the edge.
  useEffect(() => {
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = previous; };
  }, []);

  const keys = useMemo(() => items.map((item) => item.key), [items]);
  /**
   * HER ANSWER IS A WORD, not a transcript. A topic goes there, yes goes to
   * the first, no leaves. The mic opens when she stops talking, never while
   * she is: an open mic during playback records her.
   */
  const voice = useVoiceInput({
    onResult: (said) => {
      const topic = heardTopic(said, keys);
      if (topic) { leave.current(BRIEFING_GOES_TO[topic]); return; }
      const yes = heardYes(said);
      if (yes === null) return; // not an answer, keep waiting
      leave.current(yes ? BRIEFING_GOES_TO[keys[0]] : null);
    },
  });

  // The mic opens only after she has asked. The screen closes itself if nobody
  // answers, mic or not: the buttons are there, so no mic is no excuse to stay.
  useEffect(() => {
    if (!asking) return undefined;
    if (voice.supported) voice.start();
    const timer = setTimeout(() => leave.current(null), ANSWER_WINDOW_MS);
    return () => { clearTimeout(timer); if (voice.supported) voice.stop(); };
  }, [asking, voice.supported]);

  const [orbSlotRef, orbSize] = useOrbSlot(ORB_FILL);
  // SHE ALREADY HAS A LEVEL, so the orb is handed one rather than opening a
  // mic of its own: `tts` while she talks, `voice` while she listens, else -1.
  const orbLevelRef = useRef(-1);
  const listening = asking && voice.listening;
  orbLevelRef.current = tts.speaking ? tts.level : listening ? voice.level : -1;
  const orbState = tts.speaking ? ORB_STATE.speaking : listening ? ORB_STATE.listening : ORB_STATE.idle;

  // THE STACK IS MEMOISED: her voice level re-renders this page ~60 times a second,
  // and every card and breakdown re-rendering with it was the lag. 2026-09-28.
  const stack = useMemo(() => {
    // EVERY TOPIC IS A CARD, the newest in front and the rest receding in Z, his
    // call 2026-09-28. A card holds ALL its lines from the moment it appears,
    // the unsaid ones laid out but invisible, so it never grows while she talks.
    const lineProps = (index) => ({ active: index === spoken, done: index < spoken, pending: index > spoken });
    // Every card built first, THEN only the reached ones kept: filtering while
    // building hung a later topic's reads on the last card shown. 2026-09-28.
    const all = [];
    segments.forEach((segment, index) => {
      if (segment.kind === 'read' && all.length > 0) all.at(-1).parts.push({ segment, index });
      else all.push({ id: `${segment.kind}-${segment.key ?? index}`, parts: [{ segment, index }] });
    });
    const cards = all.filter((card) => card.parts[0].index <= spoken);
    cardCountRef.current = cards.length;
    const front = focus ?? cards.length - 1;
    const itemByKey = new Map(items.map((item) => [item.key, item]));
    const arrived = items.flatMap((item) => item.rows.filter((r) => r.status === ROW_STATUS.NEW));
    const open = (to) => leave.current(to);

    /**
     * What a topic card shows under its count line, there from the start. Each
     * entry LIGHTS while she reads it and settles once read. See cardEntries().
     */
    const breakdown = (key, lit) => {
      const item = itemByKey.get(key);
      if (!item) return null;
      const entries = cardEntries(item);
      if (DETAIL_KEYS.includes(key)) {
        return entries.map((e, order) => <DetailRow key={e.id} row={e.row} keyName={key} order={order} state={lit(e.id)} />);
      }
      // NO TOTALS, shown or said: his call 2026-09-28. The card is the breakdown.
      return <Breakdown entries={entries} lit={lit} />;
    };

    const cardBody = (card) => {
      const [{ segment }] = card.parts;
      const lines = card.parts.filter(({ segment: s }) => s.kind !== 'read').map(({ segment: s, index: i }) => (
        <Line key={i} text={s.text} to={s.kind === 'head' ? BRIEFING_GOES_TO[s.key] : undefined} onOpen={open} {...lineProps(i)} />
      ));
      if (segment.kind === 'head') {
        // Which entries she is reading now, and which she has read.
        const state = new Map();
        for (const { segment: s, index: i } of card.parts) {
          if (s.kind !== 'read') continue;
          const now = i === spoken ? READ_STATE.ACTIVE : i < spoken ? READ_STATE.DONE : READ_STATE.WAITING;
          for (const id of s.ids) state.set(id, now);
        }
        const lit = (id) => state.get(id) ?? READ_STATE.DONE;
        return (
          <>
            {lines}
            <div className="mt-3 flex flex-col gap-1">{breakdown(segment.key, lit)}</div>
          </>
        );
      }
      if (segment.kind === 'closing') {
        // What arrived while she talked, counted by company.
        const entries = groupCounts(arrived).map((g) => ({ id: g.name, name: g.name, count: g.count }));
        return (
          <>
            {lines}
            {arrived.length > 0 && <div className="mt-3"><Breakdown entries={entries} lit={() => READ_STATE.DONE} /></div>}
          </>
        );
      }
      if (segment.kind === 'ask') {
        // Every topic the briefing carried, in the order she said them.
        const topics = items.map((item) => item.key).filter((key) => BRIEFING_GOES_TO[key]);
        return (
          <>
            {lines}
            <AskChoices keys={topics} onPick={open} />
          </>
        );
      }
      return lines;
    };

    // THE STACK: HUD panels, his call 2026-09-28 ("like JARVIS").
    const topicTotal = items.length;
    let topicNo = 0;
    return (
    <div className="relative h-[24rem] w-full max-w-[40rem]" style={{ perspective: STACK_PERSPECTIVE_PX }}>
      {cards.map((card, position) => {
        const [{ segment: first }] = card.parts;
        if (first.kind === 'head') topicNo += 1;
        const depth = front - position;
        // One step ahead of the front is kept, so a card going forward flies out rather than vanishing.
        if (depth > STACK_DEPTH || depth < -1) return null;
        const ahead = depth < 0;
        const reads = card.parts.filter(({ segment: s }) => s.kind === 'read').map(({ index: i }) => i);
        const label = first.kind === 'head'
          ? `${pad(topicNo)} / ${pad(topicTotal)}  ·  ${TOPIC_LABEL[first.key] ?? ''}`
          : HUD_LABEL[first.kind] ?? '';
        const edge = tint(depth === 0 ? STACK_EDGE_FRONT : STACK_EDGE_BACK, palette.signal);
        return (
          <div
            key={card.id}
            className="briefing-card absolute inset-x-0 top-1/2"
            style={{
              transform: ahead
                ? `translateY(-50%) translate3d(0, ${STACK_STEP_Y}px, ${STACK_STEP_Z}px)`
                : `translateY(-50%) translate3d(0, ${-depth * STACK_STEP_Y}px, ${-depth * STACK_STEP_Z}px)`,
              opacity: ahead ? 0 : Math.max(0, 1 - depth * STACK_FADE),
              pointerEvents: ahead ? 'none' : 'auto',
              zIndex: STACK_DEPTH - depth,
            }}
          >
            {/* The frame is the fill showing 1px around the panel: a clipped border with cut corners. */}
            <div style={{ clipPath: HUD_CHAMFER, background: edge, padding: 1 }}>
              <div
                className="relative overflow-hidden px-6 pb-5 pt-3"
                // Solid, so the card behind never ghosts through. No blur: it lagged over the orb.
                style={{ clipPath: HUD_CHAMFER, background: `linear-gradient(180deg, ${palette.panel}, ${palette.void})` }}
              >
                {depth === 0 && (
                  <span
                    className="hud-scan pointer-events-none absolute inset-0"
                    style={{ background: `linear-gradient(180deg, transparent 0%, ${tint(0.07, palette.signal)} 50%, transparent 100%)` }}
                  />
                )}
                <div className="mb-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.25em]" style={{ fontFamily: HUD_FONT, color: tint(0.8, palette.dim) }}>
                  <span className="truncate">{`▸ ${label}`}</span>
                  {reads.length > 0 && (
                    <span className="flex shrink-0 gap-[3px]" aria-hidden="true">
                      {reads.map((i) => (
                        <span
                          key={i}
                          className={`h-[3px] w-4 ${i === spoken ? 'animate-pulse' : ''}`}
                          style={{ background: i <= spoken ? palette.signal : tint(0.2, palette.signal) }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                <div className="briefing-card-in">{cardBody(card)}</div>
              </div>
            </div>
            <Brackets colour={depth === 0 ? palette.hot : tint(0.35, palette.signal)} />
            {/* A card behind is a way back: clicking it brings it forward. */}
            {depth > 0 && (
              <button
                type="button"
                aria-label="Bring this card forward"
                onClick={() => setFocus(position)}
                className="absolute inset-0 min-h-0 border-0 bg-transparent p-0"
              />
            )}
          </div>
        );
      })}
    </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, spoken, items, focus, palette]);

  // NOTHING TO SAY, NOTHING TO SHOW. The caller already checks.
  if (!initialItems?.length) return null;


  return (
    <div
      className="fixed inset-0 z-[70] transition-opacity duration-500"
      style={{ background: palette.void, opacity: leaving ? 0 : 1 }}
    >
      <DianeEnvironment />

      {/* Behind the words, centred on the screen. Sized to a sphere, not the
          viewport: a full screen of particles is what made this scene slow. */}
      <div ref={orbSlotRef} className="pointer-events-none absolute inset-0">
        {orbSize > 0 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <HudRings size={orbSize * HUD_RING_FILL} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <Suspense fallback={null}>
                <ParticlesOrb
                  state={orbState}
                  size={orbSize}
                  levelRef={orbLevelRef}
                  colorFrom={palette.signal}
                  colorTo={palette.accent}
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      {/* THE HUD READOUTS, top corners: who is talking, and when. */}
      <div className="pointer-events-none absolute left-[4vw] top-[4vh] text-[10px] uppercase tracking-[0.3em]" style={{ fontFamily: HUD_FONT, color: tint(0.85, palette.signal) }}>
        <div>D.I.A.N.E</div>
        <div className="mt-1" style={{ color: tint(0.55, palette.dim) }}>{`Daily briefing  //  ${orbState}`}</div>
      </div>
      <HudClock />

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4">
        {stack}

        {/* A STATE, not an instruction: the words she is listening for. */}
        <span
          className="mt-6 h-4 text-center text-[10px] uppercase tracking-[0.3em] transition-opacity duration-500"
          style={{ fontFamily: HUD_FONT, color: tint(0.75, palette.signal), opacity: asking && voice.listening ? 1 : 0 }}
        >
          {[...keys.map((key) => TOPIC_WORDS[key]?.[0]).filter(Boolean), NO].join('  ·  ')}
        </span>
      </div>

      {/* BACK, NEXT and SKIP, bottom right. Quiet: they are the way past, not the way in. */}
      <div className="absolute bottom-[4vh] right-[4vw] flex gap-1">
        {[
          { label: 'Back', run: () => back.current(), hidden: (focus ?? cardCountRef.current - 1) <= 0 },
          { label: 'Next', run: () => forward.current(), hidden: asking && focus === null },
          { label: 'Skip', run: () => leave.current(null) },
        ].filter((c) => !c.hidden).map((control) => (
          <button
            key={control.label}
            type="button"
            onClick={control.run}
            className="min-h-0 border-0 bg-transparent px-3 py-2 text-[10px] uppercase tracking-[0.3em] transition-colors"
            style={{ fontFamily: HUD_FONT, color: tint(0.55, palette.dim) }}
            onMouseEnter={(e) => { e.currentTarget.style.color = palette.hot; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = tint(0.55, palette.dim); }}
          >
            {`[ ${control.label} ]`}
          </button>
        ))}
      </div>
    </div>
  );
}
