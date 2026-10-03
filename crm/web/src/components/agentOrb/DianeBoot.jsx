import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../../configs/api.config';
import { queryClient } from '../../lib/queryClient';
import {
  dashboardCacheKey, dashboardQueryParams, defaultDashboardFilters, DASHBOARD_REQUEST,
} from '../../helpers/dashboard';
import { useDianePalette } from './DianePalette';
import DianeEnvironment from './DianeEnvironment';
import { nextGreeting, briefingShownToday } from './briefingAnswer';
import { primeSpeech } from './speechCache';

const ParticleOrb = lazy(() => import('./ParticleOrb'));

/**
 * The boot screen between signing in and the CRM.
 *
 * The rule this is built around, user's own: the bar reaches 100% only when
 * Diane is genuinely ready to work — never on a timer. So every step below
 * is a real await on a real thing, and the percentage is just how many of
 * them have resolved. If her chunk is slow on a cold cache, or the TTS
 * check hangs, the bar sits there, because she isn't ready.
 *
 * The one concession: the bar EASES toward the true value instead of
 * jumping, so a step that completes instantly still reads as progress.
 * It eases toward the real number, never past it.
 */

// Order matters — this is also the order they're listed on screen, so it
// should read like a plausible startup sequence rather than the order the
// promises happen to settle in.
const STEPS = [
  { key: 'session', label: 'Verifying your session' },
  { key: 'workspace', label: 'Opening the master sheet' },
  { key: 'pages', label: 'Loading your pages' },
  { key: 'dashboard', label: 'Adding up the month' },
  { key: 'briefing', label: 'Checking what needs doing' },
  { key: 'voice', label: 'Warming up her voice' },
  { key: 'engine', label: 'Loading Diane' },
  { key: 'render', label: 'Waking her up' },
  // Work he parked for this month, applied before he lands. Always listed:
  // it runs on every sign in (the queue decides whether there is anything
  // to do), so unlike the roll it is never conditionally absent.
  { key: 'scheduled', label: 'Doing this month\'s updates' },
];

// New month preset roll: listed LAST, on the month's first THREE sign ins.
// Half the bar, per deal. It ran once and marked itself done, so a PATCH
// that failed left deals behind until the month turned again.
const PRESET_TRY_KEY = 'presetRoll.attempts';
const PRESET_TRIES = 3;
const PRESET_WEIGHT = STEPS.length;
const ROLL_PARALLEL = 4;
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
function triesUsed() {
  try {
    const [month, n] = (localStorage.getItem(PRESET_TRY_KEY) || '').split(':');
    return month === thisMonth() ? Number(n) || 0 : 0;
  } catch { return 0; }
}
function markTry(used) {
  try { localStorage.setItem(PRESET_TRY_KEY, `${thisMonth()}:${used + 1}`); } catch { /* storage blocked */ }
}
function presetLabel(month) {
  const day = new Date(`${month}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `Updating presets to ${day}`;
}

/**
 * The pages' first-page data, warmed into React Query's cache while the
 * boot screen is on screen anyway.
 *
 * The keys and arguments must match what the hooks ask for EXACTLY or the
 * prefetch is wasted — a different page size or a missing filter is a
 * different cache key, and the page refetches as if nothing was warmed.
 * Hence the duplication of defaults here; they're copied from the hooks
 * (useCompanies.js, useMasterSheet.js, useConcerns.js), not invented.
 *
 * Failures are ignored on purpose. This is an optimisation — if one of
 * these 500s, the page will ask again itself and show its own error.
 */
const PREFETCH = [
  {
    // Must match usePeople's own key exactly (['people', filters]) or the
    // prefetch warms a cache entry the page never reads.
    queryKey: ['people', { page: 1, pageSize: 25 }],
    queryFn: () => apiService.people.list({ page: 1, pageSize: 25 }),
  },
  {
    queryKey: ['master-sheet', 'all', 'all', 'all', '', 1, 50],
    queryFn: () => apiService.masterSheet.list({ page: 1, pageSize: 50 }),
  },
  {
    queryKey: ['concerns', 'open', null, null, 'all', '', 1, 50],
    queryFn: () => apiService.concerns.list({ status: 'open', page: 1, pageSize: 50 }),
  },
];

// She is not allowed to finish before this. Not padding for its own sake:
// on a warm cache every step resolves inside ~200ms, and a progress bar
// that flashes 0 to 100 and vanishes reads as a broken frame rather than
// as a system coming up.
const MIN_VISIBLE_MS = 1400;
const FADE_MS = 600;
// How long the loading screen waits for her first line's audio before letting go.
const GREETING_WAIT_MS = 5000;
// How long "Waking her up" waits for the orb's first frame once her code is loaded.
const RENDER_WAIT_MS = 4000;

export default function DianeBoot({ onDone }) {
  // The chosen theme's palette. See configs/themes.js.
  const palette = useDianePalette();
  const { tint } = palette;
  const [done, setDone] = useState(() => ({}));
  const [displayed, setDisplayed] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startedAt = useRef(Date.now());
  // Handed to onDone, so whatever renders the briefing does not fetch it
  // again. A ref, not state: nothing on this screen draws it.
  const briefingRef = useRef(null);
  // What the parked work did, handed to onDone so the welcome page can
  // report it without asking the server again.
  const scheduledRef = useRef(null);
  const finishedRef = useRef(false);
  // The two timers that carry the exit. Held here, not in the effect's
  // closure — see the leave effect below for why they must outlive it.
  const exitTimers = useRef([]);
  // Read ONCE, before the effect spends an attempt, so the step is in the
  // list from the first frame instead of appearing once work is found.
  const triesRef = useRef(triesUsed());
  const startedRef = useRef(false);
  const rolling = triesRef.current < PRESET_TRIES;
  const [roll, setRoll] = useState(() => ({ month: `${thisMonth()}-01`, done: 0, total: 0 }));
  const steps = rolling
    ? [...STEPS, { key: 'presets', label: presetLabel(roll.month) }]
    : STEPS;

  const complete = useCallback((key) => {
    setDone((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  // ---- the actual readiness checks ------------------------------------
  useEffect(() => {
    // Reaching this component at all means the session is real — Layout
    // only mounts behind RequireAuth. Listed anyway because it IS a step,
    // and hiding a step that's already true would make the sequence lie
    // about what it checked.
    complete('session');

    /**
     * ===============================
     * * THE TWO MONTH START JOBS, IN ORDER
     * ===============================
     * The roll first, the parked work second, never together. The roll
     * moves `preset_on`, which recomputes payable days and amount — so a
     * parked change to an amount applied before it would be wiped by it.
     *
     * The ref guard is StrictMode's double-invoked effect: without it one
     * sign in spends two of the three roll attempts.
     */
    if (!startedRef.current) {
      startedRef.current = true;

      // Each deal through the row PATCH, so payable days recompute and
      // History logs it. Resolves either way; a failed roll must not hold
      // the parked work, and neither may hold the way in.
      const rolled = rolling
        ? (() => {
          markTry(triesRef.current);
          return apiService.masterSheet
            .presetRollCheck()
            .then(async ({ month, ids, batchId }) => {
              if (!ids?.length) { setRoll((r) => ({ ...r, month: month || r.month })); return; }
              let moved = 0;
              setRoll({ month, done: 0, total: ids.length });
              const queue = [...ids];
              const worker = async () => {
                while (queue.length) {
                  const id = queue.shift();
                  await apiService.masterSheet.update(id, { presetOn: month }, { roll: batchId }).catch(() => {});
                  moved += 1;
                  setRoll({ month, done: moved, total: ids.length });
                }
              };
              await Promise.all(Array.from({ length: ROLL_PARALLEL }, worker));
              queryClient.invalidateQueries();
            })
            // Ticked on every path, including a failed check: the step is
            // in the list, so it can never be why nobody gets off here.
            .catch(() => {})
            .finally(() => complete('presets'));
        })()
        : Promise.resolve();

      /**
       * Asked on EVERY sign in, not three times. What actually RUNS is
       * decided by the queue's own status, so a second tab, a second
       * machine or a tenth sign in finds nothing left to do. The per row
       * attempt budget lives in the table for the same reason: the roll's
       * localStorage counter is per browser and resets when you switch.
       */
      rolled
        .then(() => apiService.masterSheet.runScheduled())
        .then((report) => {
          scheduledRef.current = report;
          if (report?.ran?.length) queryClient.invalidateQueries();
        })
        .catch(() => {})
        .finally(() => complete('scheduled'));
    }

    // Her primary table. A failure here is genuinely worth knowing about
    // before she offers to edit it — but it must not trap anyone on this
    // screen, so a rejection still counts as settled.
    apiService.masterSheet
      .list({ pageSize: 1 })
      .catch(() => {})
      .finally(() => complete('workspace'));

    // The pages themselves, warmed in parallel. This is the whole reason
    // the boot screen is worth having beyond the orb: you're already
    // waiting, so spend it filling the cache the pages read from. Without
    // it, every page paid ~450ms per query on first open — network
    // latency to Supabase, which no index or query change improves.
    Promise.allSettled(
      PREFETCH.map((options) => queryClient.prefetchQuery({ ...options, staleTime: 30_000 })),
    ).finally(() => complete('pages'));

    /**
     * THE DASHBOARD, its own step because it is the slowest page there is:
     * six months of snapshots, four cards and two charts. Landing on it
     * cold was the longest wait in the CRM, and hiding it inside "Loading
     * your pages" would make that step's duration unexplainable.
     *
     * Its key comes from helpers/dashboard.js rather than being written
     * out here: a prefetch whose key differs by one field warms an entry
     * the page never reads, which is slower for the work and silent.
     */
    queryClient
      .prefetchQuery({
        queryKey: dashboardCacheKey(),
        queryFn: () => apiService.dashboard.get(
          dashboardQueryParams({ ...defaultDashboardFilters(), ...DASHBOARD_REQUEST }),
        ),
        staleTime: 30_000,
      })
      .catch(() => {})
      .finally(() => complete('dashboard'));

    /**
     * AND WHAT SHE IS ABOUT TO SAY. Fetched HERE rather than by whatever
     * renders the briefing, so the bar genuinely waits for it: she opens
     * ready to speak instead of on an empty canvas.
     *
     * A failure is an empty briefing, which the screen reads as "nothing
     * to say" and skips. It is never worth a red bar on the way in.
     */
    apiService.briefing
      .get()
      .then((res) => {
        briefingRef.current = res;
        // Already briefed today: no greeting to make (Layout skips the items).
        if (!res?.items?.length || briefingShownToday(res)) return undefined;
        // HER FIRST LINE, MADE NOW: the voice service takes 3 to 9 seconds, and the
        // welcome page opened on that silence. Waited for, but never past the cap. 2026-09-28.
        const greeting = nextGreeting();
        const audio = apiService.masterSheet.speech(greeting);
        primeSpeech(greeting, audio);
        briefingRef.current = { ...res, greeting };
        return Promise.race([audio, new Promise((resolve) => { setTimeout(resolve, GREETING_WAIT_MS); })]);
      })
      .catch(() => { briefingRef.current ??= { items: [] }; })
      .finally(() => complete('briefing'));

    // Whether server-side TTS is configured. Same reasoning: the answer
    // can be "no", and "no" is still an answer.
    apiService.masterSheet
      .speechStatus()
      .catch(() => {})
      .finally(() => complete('voice'));

    // Three.js plus her geometry: the big one, and the only step whose
    // duration really varies. Preloading it here is half the point of this
    // screen existing, so the first Ask Diane opens instantly instead of
    // waiting on the chunk.
    import('./ParticleOrb').then(
      () => {
        complete('engine');
        // A hidden tab never runs her first frame; never strand anyone on it.
        setTimeout(() => complete('render'), RENDER_WAIT_MS);
      },
      () => {
        // Chunk failed to load (offline, a stale deploy). Let the CRM
        // through without her rather than stranding someone on a bar that
        // will never move; the orb's own fallback covers the visuals.
        complete('engine');
        complete('render');
      },
    );
  }, [complete, rolling]);

  // ---- ease the bar toward the real number -----------------------------
  const baseDone = STEPS.filter((s) => done[s.key]).length;
  // Before the check answers there is no denominator, so the roll is worth 0
  // of its weight — the bar waits on it rather than counting it done.
  const rollShare = done.presets ? 1 : (roll.total ? roll.done / roll.total : 0);
  const target = rolling
    ? ((baseDone + PRESET_WEIGHT * rollShare) / (STEPS.length + PRESET_WEIGHT)) * 100
    : (baseDone / STEPS.length) * 100;

  useEffect(() => {
    let raf;
    const tick = () => {
      setDisplayed((v) => (Math.abs(target - v) < 0.4 ? target : v + (target - v) * 0.08));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // Only a real unmount may cancel the exit. Not the effect below.
  useEffect(() => () => exitTimers.current.forEach(clearTimeout), []);

  /**
   * ---- leave, once she's actually ready --------------------------------
   *
   * NO PER RUN CLEANUP, and that is the fix, not an oversight. `displayed`
   * is in the deps and moves every eased frame, so a `return () =>
   * clearTimeout(t)` cancelled the one exit ever scheduled: `finishedRef`
   * makes the next run return early, nothing reschedules, and the bar sits
   * at 100% saying "Ready" forever. Seen on a warm boot 2026-10-01.
   *
   * Leaving is COMMITTED the moment the gate passes. The timers live in a
   * ref so unmount can still clear them.
   */
  useEffect(() => {
    if (finishedRef.current) return;
    if ((rolling && !done.presets) || target < 100 || displayed < 99.4) return;
    finishedRef.current = true;

    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    exitTimers.current.push(setTimeout(() => {
      // Fade first, unmount after. The CRM is already mounted underneath
      // this screen, so the fade reveals it in place rather than flashing.
      setLeaving(true);
      exitTimers.current.push(
        setTimeout(
          () => onDone?.({ briefing: briefingRef.current, scheduled: scheduledRef.current }),
          FADE_MS,
        ),
      );
    }, wait));
  }, [target, displayed, onDone, rolling, done.presets]);

  const pct = Math.round(displayed);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: palette.void, transitionDuration: `${FADE_MS}ms` }}
      role="status"
      aria-live="polite"
      aria-label={`Starting up, ${pct} percent`}
    >
      <DianeEnvironment />

      <div
        className="relative"
        style={{ width: 'clamp(200px, 30vh, 320px)', height: 'clamp(200px, 30vh, 320px)' }}
      >
        <Suspense fallback={null}>
          {/* `thinking`, not `idle` — she is doing something, and the
              faster line activity in that mode is what makes the wait read
              as work rather than as a stall. */}
          <ParticleOrb mode="thinking" level={0} formIn onReady={() => complete('render')} />
        </Suspense>
      </div>

      <div className="relative w-full max-w-sm px-8 mt-6">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm text-white/55">{currentLabel(done, steps)}</span>
          <span
            className="text-sm font-bold text-diane-signal tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {pct}%
          </span>
        </div>

        <div className="h-[3px] w-full overflow-hidden" style={{ background: tint(0.12) }}>
          <div
            className="h-full"
            style={{
              width: `${displayed}%`,
              background: `linear-gradient(90deg, ${palette.dim}, ${palette.hot})`,
              boxShadow: `0 0 12px ${tint(0.7)}`,
            }}
          />
        </div>

        {/* Each step, ticked as it lands. Not decoration: when this screen
            hangs, this is the only thing that says on WHAT. */}
        <ul className="mt-5 flex flex-col gap-1.5 list-none p-0 m-0">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2.5 text-xs">
              <span
                className="w-1.5 h-1.5 shrink-0 rounded-full transition-colors duration-300"
                style={{
                  background: done[s.key] ? palette.signal : tint(0.22),
                  boxShadow: done[s.key] ? `0 0 8px ${tint(0.8)}` : 'none',
                }}
              />
              <span className={done[s.key] ? 'text-white/60' : 'text-white/25'}>{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// The first step still outstanding — what she's actually waiting on right
// now, rather than the last one that finished.
function currentLabel(done, steps) {
  const next = steps.find((s) => !done[s.key]);
  return next ? `${next.label}…` : 'Ready';
}
