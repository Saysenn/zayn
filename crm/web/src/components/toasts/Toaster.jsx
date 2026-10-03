import { Link } from 'react-router-dom';
import { useNotifications } from '../../hooks/useNotifications';
import { useDiane } from '../agentOrb/DianeContext';
import { CloseIcon } from '../icons';

/**
 * The stacked strips, tucked into the top-right corner.
 *
 * z-[60] on purpose. This used to be z-30 — the same layer as Diane's
 * overlay — so any toast raised while she was open rendered behind her and
 * was never seen. With optimistic UI that isn't cosmetic: a failed save
 * reverts a value on screen, and the toast is the only thing that says
 * why.
 *
 * The design deliberately has no thick coloured bar down the side. That
 * reads as a generic template; the colour belongs on the icon, where it
 * marks meaning, and the strip itself stays quiet.
 */

const ICONS = {
  check: <path d="M20 6L9 17l-5-5" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.01" /></>,
  warn: <><path d="M12 3l9 16H3z" /><path d="M12 9v4M12 16.5v.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></>,
  import: <path d="M12 19V7M7 12l5-5 5 5M4 21h16" />,
  // Undo. Same shape as RestoreIcon in icons.jsx: putting a value back is
  // its own kind of write, not a plain save.
  restore: <><path d="M3 7h18v3H3z" /><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" /><path d="M12 18v-5" /><path d="M9.5 15.5 12 13l2.5 2.5" /></>,
};

// One map, the same shape as Button's VARIANTS — so "make warnings amber"
// stays a one-line change rather than a hunt through markup.
const LEVELS = {
  success: { icon: 'check', tint: 'bg-accent-tint', fg: 'text-accent-strong' },
  error: { icon: 'alert', tint: 'bg-danger-tint', fg: 'text-danger' },
  warning: { icon: 'warn', tint: 'bg-warning-tint', fg: 'text-warning' },
  info: { icon: 'info', tint: 'bg-surface-sunken', fg: 'text-text-muted' },
};

export default function Toaster() {
  const { toasts, dismissToast } = useNotifications();
  const { open: dianeOpen } = useDiane();

  if (toasts.length === 0) return null;

  // Silent while Diane's command center is open — user's own call. Her
  // overlay is a full-screen world of its own, and a CRM toast sliding
  // into the corner of it breaks that. She reports her own results in the
  // conversation anyway.
  //
  // HELD, not discarded: they stay in state, so anything still alive when
  // she closes appears then. Errors never auto-dismiss, so a failure
  // raised behind her is guaranteed to be seen rather than swallowed.
  if (dianeOpen) return null;

  return (
    <div
      // Starts BELOW the page header, not over it. The header is sticky
      // and holds "Ask Diane" in the same top-right corner — a toast
      // landing on top of it covered the one control that's meant to be
      // reachable from every page. `top` is the header's own height token
      // (tailwind.config.js `spacing.header`) plus a small gap, so the two
      // can't drift apart if that height ever changes.
      className="fixed right-3 top-[calc(theme(spacing.header)+0.5rem)] z-[60] flex flex-col gap-2 w-full max-w-[19rem] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const level = LEVELS[t.level] ?? LEVELS.info;
        // An explicit icon wins over the level's default — a delete is a
        // success, but a bin says what happened far faster than a tick.
        const icon = ICONS[t.icon] ?? ICONS[level.icon];

        // Only socket toasts have a destination. A "Saved" toast has
        // nowhere to go, and wrapping it in a link to "/" meant an
        // accidental click threw you off the page you were editing.
        const Body = t.to ? Link : 'div';
        const bodyProps = t.to ? { to: t.to, onClick: () => dismissToast(t.id) } : {};

        return (
          <div key={t.id} className="toast">
            {/* ROUND, like every other one-fact mark in the CRM (`.badge`).
                A hard square chip beside rounded corners was the one thing
                on the strip still drawn to the old shape. */}
            <span
              className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full ${level.tint} ${level.fg}`}
              aria-hidden="true"
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              >
                {icon}
              </svg>
            </span>

            <Body {...bodyProps} className="flex-1 min-w-0 no-underline">
              <p className="text-[0.8rem] font-semibold text-text m-0 leading-snug">{t.message}</p>
              {t.detail && (
                <p className="text-[0.7rem] text-text-muted m-0 mt-0.5 leading-snug line-clamp-2">
                  {t.detail}
                </p>
              )}
            </Body>

            {/* THE SHARED ICON, not a ✕ character. The glyph rendered at
                whatever the font felt like and sat off centre beside a 14px
                icon on the other side of the strip. */}
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
            >
              <CloseIcon width={13} height={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
