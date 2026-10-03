import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSocketConnection } from '../../hooks/useSocket';
import { useConcerns } from '../../hooks/useConcerns';
import { useUnreadChat } from '../../hooks/useChat';
import { NotificationProvider } from '../../hooks/useNotifications';
import { useReviewPending } from '../../hooks/useMonthlyReview';
import { LockIcon, SparkleIcon } from '../icons';
import * as Icons from '../icons';
import {
  NAV_ITEMS, NAV_TOP, VISIBLE_GROUPS, WORKSPACE_NAME,
} from '../../configs/navigation';
import Toaster from '../toasts/Toaster';
import AdminMenu from './AdminMenu';
import DianeBoot from '../agentOrb/DianeBoot';
import DianeBriefing from '../agentOrb/DianeBriefing';
import { briefingShownToday, markBriefingShown } from '../agentOrb/briefingAnswer';
import AgentOverlay, { prefetchOrb } from '../agentOrb/AgentOverlay';
import { DianeProvider, useDiane } from '../agentOrb/DianeContext';
import { ACTIVE_NAV_CLASS, INACTIVE_NAV_CLASS } from '../../configs/navigationStyles';

// Set by useVerifyCode (hooks/useAuth.js) the moment a sign-in succeeds,
// consumed and cleared here on the next Layout mount. Keyed off the actual
// login event, not "has this tab mounted Layout before": the latter meant
// a single refresh consumed the boot screen for the rest of the tab's
// life, including across a real sign-out/sign-in. Kept in sync by hand
// with the same constant there rather than imported, because importing it
// from useAuth into Layout and back would be circular.
const JUST_LOGGED_IN_KEY = 'diane-just-logged-in';

// The nav lives in configs/navigation.js: every item, its order and its
// group, read by this sidebar AND by the phone's bottom bar.

// Shape only. The two states live in configs/navigationStyles so this and
// the settings sidebar cannot drift.
const sidebarLink = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold no-underline transition duration-150 ${
    isActive
      ? ACTIVE_NAV_CLASS
      : INACTIVE_NAV_CLASS
  }`;

// `min-w-0` is not cosmetic: a flex item will not shrink below its own
// content by default, so five labels held the bar wider than a phone and
// pushed Flagged off the end of it.
const bottomLink = ({ isActive }) =>
  `relative m-1 min-w-0 flex-1 flex flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold no-underline transition ${
    isActive ? ACTIVE_NAV_CLASS : INACTIVE_NAV_CLASS
  }`;

// ===============================
// * A COUNT YOU CANNOT READ IS NOT A COUNT
// ===============================
// It capped at NINE, so forty open concerns and ten read the same. The
// ceiling is a real one now and the badge says when it cut. One definition,
// because the sidebar and the phone bar both answer to it.
const BADGE_MAX = 99;
const badgeText = (count) => (count > BADGE_MAX ? `${BADGE_MAX}+` : String(count));

/**
 * A circle at one digit, a pill at two: `min-w` equal to the height rather
 * than a fixed width, so the shape follows the number. It was a hard edged
 * red square, which reads as a warning box rather than as a count.
 *
 * TWO TONES, because they mean two different things. Red is an alarm:
 * somebody raised a concern, somebody is waiting on a reply. Gold is a
 * QUESTION waiting, which is the review, and drawing that red would say
 * something is wrong when nothing is.
 */
// ONE MAP, worn by the sidebar's number and by the phone bar's dot, so the
// two cannot end up saying different things about the same page.
const TONE_FILL = {
  alarm: 'bg-danger',
  question: 'bg-warning',
};

function NavBadge({ count, tone = 'alarm' }) {
  if (!count) return null;
  return (
    <span className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none tabular-nums text-white shadow-sm ${TONE_FILL[tone]}`}>
      {badgeText(count)}
    </span>
  );
}

// Every count is server-derived: open concerns, unread chat threads and
// unanswered reviews are real, persistent facts, not client-tracked "have I
// seen this" state. See useUnreadChat, useConcerns and useMonthlyReview.
function useNavCounts() {
  // Only the count matters here, not the rows — pageSize:1 keeps this from
  // pulling a full page just to read `total` (real total across every open
  // concern, not just what fits on one page — that would undercount past
  // 50 open concerns since useConcerns is paginated).
  const { total: flaggedTotal } = useConcerns({ status: 'open', pageSize: 1 });
  const { total: chatTotal } = useUnreadChat();
  // Its own tiny query, count and money only. The Review page fetches the
  // whole queue; this never does.
  const { count: reviewCount } = useReviewPending();
  return { flagged: flaggedTotal, chat: chatTotal, review: reviewCount };
}

// The count a row carries, and what kind of thing it is.
const BADGE_FOR = {
  '/flagged': { key: 'flagged', tone: 'alarm' },
  '/chat': { key: 'chat', tone: 'alarm' },
  '/review': { key: 'review', tone: 'question' },
};

// THE WHOLE ICON MODULE, so a nav entry naming an icon resolves without a
// second hand kept map beside the config. A name that does not exist is
// caught by configs/navigation.test.js rather than by a blank sidebar.
function NavRow({ item, counts }) {
  const { to, label, end } = item;
  const Icon = Icons[item.icon];
  const badge = BADGE_FOR[to];
  return (
    <NavLink to={to} end={end} className={sidebarLink}>
      <Icon />
      <span className="flex-1">{label}</span>
      <NavBadge count={badge ? counts[badge.key] : 0} tone={badge?.tone} />
    </NavLink>
  );
}

/**
 * GROUPED BY WHAT THE MONEY IS DOING. The four Payments pages are four
 * views of one table, so they sit under a heading rather than in a flat
 * list where the master sheet looked like a peer of People.
 *
 * The groups and their order are configs/navigation.js. Nothing about the
 * shape of the CRM is decided in this file.
 */
function SidebarNav() {
  const counts = useNavCounts();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-2">
      {NAV_TOP.map((item) => <NavRow key={item.to} item={item} counts={counts} />)}

      {VISIBLE_GROUPS.map((group) => (
        <div key={group.key} className="mt-4 flex flex-col gap-1 first:mt-0">
          {/* The heading is a LABEL, not a control: nothing collapses and
              nothing is clickable, so it takes no hover and no focus. */}
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
            {group.label}
          </p>
          {group.items.map((item) => <NavRow key={item.to} item={item} counts={counts} />)}
        </div>
      ))}
    </nav>
  );
}

function BottomNav() {
  const counts = useNavCounts();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(theme(spacing.bottomnav)+theme(spacing.safebottom))] pb-safebottom flex max-w-full overflow-hidden bg-surface border-t border-border z-10">
      {NAV_ITEMS.map(({ to, label, icon, end }) => {
        const Icon = Icons[icon];
        const badge = BADGE_FOR[to];
        const count = badge ? counts[badge.key] : 0;
        return (
          <NavLink key={to} to={to} end={end} className={bottomLink}>
            <span className="relative">
              <Icon />
              {/* A RING IN THE BAR'S OWN COLOUR, so the dot reads as a mark
                  ON the icon rather than as part of it. No number here: at
                  this size two digits over an icon is unreadable, and the
                  sidebar carries the count. */}
              {count > 0 && (
                <>
                  <span aria-hidden="true" className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${TONE_FILL[badge.tone]}`} />
                  {/* The dot is a shape, so the count is said in text. An
                      `aria-label` on a bare span is not reliably announced. */}
                  <span className="sr-only">{badgeText(count)} outstanding</span>
                </>
              )}
            </span>
            {/* ICONS ONLY ON A PHONE. Five labels do not fit across 375px,
                and a truncated one ("Master she…") is worse than the icon
                alone. `sr-only` rather than hidden, so the name is still
                there for a screen reader at every width. */}
            <span className="sr-only truncate sm:not-sr-only sm:max-w-full">{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/**
 * IN THE HEADER, top right, on every page.
 *
 * It floated bottom right, which put it on top of whatever the page keeps
 * at the foot of a long list: on the Master Sheet and every other
 * paginated page that is the Prev/Next control, permanently half covered.
 * A floating button owns its corner forever, and the corner it owned
 * belonged to the page.
 *
 * The header is where the session's own controls already live, and it is
 * the same place on every page, which is what floating was for.
 *
 * The theme's strong step with her sparkle (`diane-ask`). Nothing else in
 * the header is coloured, so it reads without shouting.
 */
function AskDianeButton() {
  const { openDiane, ai } = useDiane();
  // Still pressable when locked: the press says why, in the middle of the screen.
  const Icon = ai.locked ? LockIcon : SparkleIcon;
  return (
    <button
      type="button"
      onClick={openDiane}
      onMouseEnter={prefetchOrb}
      onFocus={prefetchOrb}
      title={ai.locked ? 'Diane is switched off' : 'Ask Diane'}
      aria-disabled={ai.locked || undefined}
      // `diane-skin` is her four colours, in index.css, shared with the
      // suggestion buttons on the deal form. It was four `!important`
      // utilities here, which made this the only place that knew what a
      // control of hers looks like.
      className="diane-skin diane-ask inline-flex items-center gap-1.5 min-h-0 h-8 px-3 py-0 text-sm font-semibold border"
    >
      <Icon width={16} height={16} />
      {/* The label goes on a phone, where the header holds three controls
          in 375px. The sparkle is hers and carries it alone. */}
      <span className="hidden sm:inline">Ask Diane</span>
    </button>
  );
}

// Export is deliberately NOT here. It lived in this header briefly and the
// move cost it its accuracy: People's Export seeds the modal from whatever
// that page is filtered to, and from the header there is no page filter to
// read, so it silently exported everything. It is back beside Add person.

function LayoutInner() {
  return (
    <div className="min-h-screen flex">
      <Toaster />

      {/* desktop sidebar */}
      <aside className="hidden md:flex md:flex-col w-sidebar shrink-0 bg-surface border-r border-border h-screen sticky top-0">
        {/* One line, and the name is configs/navigation's: the account menu
            says it too, so it is written once. */}
        <div className="px-5 pb-5 pt-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-accent-strong">
            {WORKSPACE_NAME}
          </p>
        </div>
        <SidebarNav />
        {/* NOTHING BELOW THE PAGES. History, Settings and Sign out were two
            rows and a red button down here, plus a second pair in the header
            for phones. They belong to whoever is signed in rather than to a
            page, so they are all behind the avatar now: see AdminMenu. */}
      </aside>

      {/* ===============================
          * NOTHING SCROLLS THE PAGE SIDEWAYS
          * ===============================
          A page-level horizontal scrollbar takes the whole layout with it:
          the phone's bottom bar is fixed to the viewport, so scrolling the
          document right slides the content out from under it and the app
          looks broken. Anything that genuinely needs to scroll sideways
          (every wide table, both charts) carries its own overflow box.

          `clip`, NOT `hidden`. `overflow-x: hidden` forces the other axis
          to `auto`, which makes this a scroll container and would break
          `position: sticky` for the header above and the settings sidebar
          inside. `clip` creates no scroll container at all. */}
      <div className="flex-1 min-w-0 overflow-x-clip">
        {/* One header across every page: the app's name, and the controls
            that belong to the session rather than to any one page. */}
        {/* NO PAGE TITLE HERE. Every page already leads with its own <h1>,
            so the header was saying "Dashboard" 40px above "Dashboard". */}
        <header className="sticky top-0 z-20 flex h-header items-center justify-end border-b border-border bg-surface/95 px-4 backdrop-blur-sm md:px-6">
          {/* `gap-3`, not 2. The avatar is a circle against a filled pill:
              at 8px the two touched and read as one control. */}
          <div className="flex items-center gap-3">
            <AskDianeButton />
            {/* AT EVERY WIDTH, not `md:hidden`. The pair of icons that used
                to sit here for phones only is inside it now, so the laptop
                and the phone reach the same three things the same way. */}
            <AdminMenu />
          </div>
        </header>

        {/* sm:p-4 reset the bottom padding while the bar still showed (640 to 767px), so it sat on the last card. */}
        <main className="px-3 pt-3 pb-[calc(theme(spacing.bottomnav)+theme(spacing.safebottom)+1rem)] sm:px-4 sm:pt-4 md:p-6 md:pb-8 xl:p-8">
          <Outlet />
        </main>

        <BottomNav />
      </div>
    </div>
  );
}

function LayoutBody() {
  // The initializer only READS: clearing happens in the effect below.
  // This mattered: an earlier version cleared inside the initializer, and
  // StrictMode (main.jsx) double-invokes initializers precisely to surface
  // impure render logic like that. First call read the flag and deleted
  // it, second call found nothing and returned false, so the boot screen
  // reliably never showed in development.
  const [justLoggedIn] = useState(() => Boolean(sessionStorage.getItem(JUST_LOGGED_IN_KEY)));

  // The boot screen runs on that signal, immediately before the CRM.
  // It exists because there was a real gap here: the orb is a
  // ~520KB Three.js chunk behind a null Suspense fallback, so a fresh
  // sign-in showed a blank screen for however long that took. DianeBoot
  // fills that gap AND preloads the chunk, so what follows it appears the
  // instant it mounts.
  const [booting, setBooting] = useState(justLoggedIn);

  /**
   * ===============================
   * * AND THEN SHE SAYS WHAT NEEDS DOING
   * ===============================
   * On the same signal, after the boot screen, so it fires on a real
   * sign-in and never on a refresh. The orb chunk is already preloaded by
   * the boot screen, so it costs nothing to show.
   *
   * NOT THE OLD GREETING SCREEN, which made you choose a destination and
   * stays gone. This tells you something and asks one question.
   *
   * FETCHED WHILE THE BOOT SCREEN IS UP, so she is ready to speak the
   * moment it lifts rather than opening on a blank canvas.
   */
  const [briefing, setBriefing] = useState(null);

  // NOTHING TO SAY, NOTHING HAPPENS. A greeting that fires every login
  // with nothing in it is the one people learn to click past.
  const [briefed, setBriefed] = useState(false);
  // NOT WHILE SHE IS LOCKED, and not until that is known, so it never flashes.
  const { ai } = useDiane();
  const showBriefing = !booting && !briefed && ai.known && !ai.locked && Boolean(briefing?.items?.length);

  // Marked when she opens, not when the boot fetch lands: a locked Diane
  // never showed it, so it is still owed.
  useEffect(() => {
    if (showBriefing) markBriefingShown(briefing);
  }, [showBriefing, briefing]);

  // Cleared once mounted, so a refresh straight after signing in doesn't
  // replay any of it. Safe under StrictMode's double-invoked effects:
  // removing an already-removed key is a no-op, and both flags above are
  // already captured in state.
  useEffect(() => {
    sessionStorage.removeItem(JUST_LOGGED_IN_KEY);
  }, []);

  // NO SCROLLBAR WHILE THE BOOT SCREEN IS UP.
  //
  // The boot screen covers the viewport, but the CRM is mounted and full
  // height underneath it, so the browser still draws its scrollbar down
  // the side of what is meant to be a clean full-bleed screen.
  //
  // Set here rather than in DianeBoot: this is a fact about the DOCUMENT,
  // and it has to be undone if the boot screen unmounts for any reason,
  // including an error. A cleanup tied to this component cannot leave the
  // page permanently unscrollable.
  useEffect(() => {
    if (!booting) return undefined;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = previous; };
  }, [booting]);

  // A SIGN-IN LANDS IN THE CRM, always. There used to be a greeting screen
  // between the boot screen and here, offering Diane or the CRM. It is
  // gone: she is a tool you reach for from the Ask Diane button, not a
  // lobby you walk through.
  return (
    <>
      <LayoutInner />
      <GlobalDiane />
      {booting && (
        <DianeBoot
          onDone={(ready) => {
            /**
             * WHAT SHE DID BEFORE HE LANDED GOES FIRST. The parked work
             * already happened, unattended, so it is the one item he has
             * not had a chance to see — everything else on this screen is
             * a thing still waiting for him.
             *
             * Built server side off the change log (agent/scheduled/
             * report.js), so it cannot describe a change that did not land.
             */
            const brief = ready?.briefing ?? { items: [] };
            const did = ready?.scheduled?.report;
            // Already briefed today: only the parked-work report, which is new, still shows.
            const items = briefingShownToday(brief) ? [] : (brief.items ?? []);
            setBriefing({ ...brief, items: did ? [did, ...items] : items });
            setBooting(false);
          }}
        />
      )}
      {showBriefing && (
        <DianeBriefing items={briefing.items} greeting={briefing.greeting} onDone={() => setBriefed(true)} />
      )}
    </>
  );
}

export default function Layout() {
  useSocketConnection();

  return (
    <NotificationProvider>
      {/* Diane is app-wide now, not per-page: ONE instance, one
          conversation, one WebGL context. The two page-level overlays this
          replaces meant two contexts and a conversation that reset every
          time you moved between them. */}
      <DianeProvider>
        <LayoutBody />
      </DianeProvider>
    </NotificationProvider>
  );
}

// Mounted once, kept mounted after the first open so the conversation and
// the WebGL context both survive closing it. Three.js still doesn't load
// until Diane is actually opened for the first time.
function GlobalDiane() {
  const { open, closeDiane, everOpened } = useDiane();
  if (!everOpened) return null;
  return <AgentOverlay open={open} onClose={closeDiane} />;
}
