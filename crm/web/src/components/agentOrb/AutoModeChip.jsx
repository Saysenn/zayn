import { FastForwardIcon } from '../icons';

/**
 * ***************************************************
 * * THE MODE, SAID ABOVE THE BOX YOU TYPE IN
 * ***************************************************
 *
 * His call 2026-09-29, and he sent the picture: Claude Code's mode line.
 * A permission mode you cannot see is one you forget you are in, and this
 * one decides whether a change to somebody's pay happens on a sentence or
 * on a sentence plus a yes. So it is stated where the sentence is typed,
 * not buried in Settings, and it is one press either way.
 *
 * SHIFT+TAB TOGGLES IT, for the same reason it does there: the hand is
 * already on the keyboard. The chip says so, because a shortcut nobody is
 * told about is a shortcut nobody uses.
 *
 * ---- ON IS LOUD AND OFF IS QUIET, never the other way round ----
 *
 * The dangerous state is the one that has to announce itself. Off is the
 * ordinary way to work and reads as a label; on is her colour, and it is
 * the only thing in this row that carries it.
 *
 * IT SAYS WHAT IT WILL STILL ASK ABOUT. "Automatically" alone reads as
 * "everything", and the closed list is one named deal or one person. The
 * title carries the rest, because the row cannot.
 */
const LABEL = { on: 'Changes automatically', off: 'Asks before changing' };

const WHY = {
  on: 'One named deal or one person, made straight away. She still asks before anything '
    + 'that deletes, stops, closes or reaches more than the row you named. Shift+Tab to turn off.',
  off: 'She shows every change and waits for a yes. Shift+Tab to let her make one named '
    + 'change without asking.',
};

export default function AutoModeChip({ on, busy, onToggle }) {
  const state = on ? 'on' : 'off';
  return (
    <div className="mb-1.5 flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={on}
        title={WHY[state]}
        className={`dm-auto min-h-0 gap-1.5 rounded-full border bg-transparent px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
          on
            ? 'border-diane-signal/50 text-diane-signal hover:bg-diane-signal/10'
            : 'border-transparent text-diane-dim hover:border-diane-line/50 hover:text-white/70'
        }`}
      >
        <FastForwardIcon width={13} height={13} className={on ? '' : 'opacity-60'} />
        {LABEL[state]}
        {/* The shortcut, quieter than the label it belongs to. */}
        <span className="ml-0.5 font-normal text-white/25">shift+tab</span>
      </button>
    </div>
  );
}
