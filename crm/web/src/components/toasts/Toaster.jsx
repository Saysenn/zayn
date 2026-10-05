import { Link } from 'react-router-dom';
import { useNotifications } from '../../hooks/useNotifications';
import { useDiane } from '../agentOrb/DianeContext';
import {
  CloseIcon, CheckIcon, TrashIcon, AlertCircleIcon, WarningIcon, InfoIcon, ImportIcon, RestoreIcon, UndoIcon,
  StopHandIcon, ResumeIcon,
} from '../icons';

/**
 * The stacked strips, in the bottom-right corner.
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

// THE SHARED SET, not a second one drawn here. The strip used to carry its
// own seven paths at a heavier stroke, so a bin in a toast and a bin on a
// row were two different bins.
const ICONS = {
  check: CheckIcon,
  trash: TrashIcon,
  alert: AlertCircleIcon,
  warn: WarningIcon,
  info: InfoIcon,
  import: ImportIcon,
  restore: RestoreIcon,
  undo: UndoIcon,
  // The bar's Stop and Resume say what happened with their own marks.
  stop: StopHandIcon,
  resume: ResumeIcon,
};

// One map, the same shape as Button's VARIANTS — so "make warnings amber"
// stays a one-line change rather than a hunt through markup. Success is
// the fixed green, not the accent: in an orange or yellow theme an accent
// tick read as a warning.
const LEVELS = {
  success: { icon: 'check', tint: 'bg-success-tint', fg: 'text-success-strong' },
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
      // BOTTOM RIGHT, out of the way of the header and "Ask Diane". It
      // rises above the bulk bar while one is open: BulkBar writes its
      // own height to --bulkbar-h, so the two can never overlap.
      className="fixed right-3 bottom-[calc(theme(spacing.bottomnav)+theme(spacing.safebottom)+var(--bulkbar-h,0px)+0.5rem)] md:bottom-[calc(var(--bulkbar-h,0px)+0.75rem)] z-[60] flex flex-col gap-2 w-full max-w-[20rem] pointer-events-none transition-[bottom] duration-200"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const level = LEVELS[t.level] ?? LEVELS.info;
        // An explicit icon wins over the level's default — a delete is a
        // success, but a bin says what happened far faster than a tick.
        const Icon = ICONS[t.icon] ?? ICONS[level.icon];

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
              <Icon width={14} height={14} />
            </span>

            <Body {...bodyProps} className="flex-1 min-w-0 no-underline">
              <p className="text-[0.8rem] font-semibold text-text m-0 leading-snug">{t.message}</p>
              {t.detail && (
                <p className="text-[0.7rem] text-text-muted m-0 mt-0.5 leading-snug line-clamp-2">
                  {t.detail}
                </p>
              )}
            </Body>

            {/* ONE ACTION, at most: Undo after a bulk change, mostly. It
                closes the strip, since what it reported is no longer true. */}
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => { dismissToast(t.id); t.action.onClick(); }}
              >
                {t.action.label}
              </button>
            )}

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
