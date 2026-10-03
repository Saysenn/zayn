/**
 * "You had already started this."
 *
 * Shown at the top of a form that came back with a draft in it, so a form
 * that is mysteriously full is instead a form that says why. The way out
 * is beside the sentence rather than behind a menu, because the person who
 * needs it is the one who wanted to start fresh.
 *
 * Info tone, not warning: nothing is wrong and nobody has to act. It is
 * context, which is what the grey ones are for.
 */
export default function DraftNote({ onDiscard }) {
  return (
    <p className="flex flex-wrap items-center gap-2 border border-border bg-surface-sunken px-3 py-2 text-xs text-text-muted">
      <span>Picked up where you left off.</span>
      <button
        type="button"
        className="min-h-0 border-0 bg-transparent p-0 text-xs underline hover:text-text"
        onClick={onDiscard}
      >
        Start over
      </button>
    </p>
  );
}
