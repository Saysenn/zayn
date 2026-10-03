// ***************************************************
// * How far into an export they are, in the panel header
// ***************************************************
//
// The tracker lived only on the card, and the card is a transcript entry:
// three questions later it has scrolled away and there is nothing on screen
// saying an export is half built. The header is the one place that cannot
// scroll, so the count lives there while a session is open.
//
// NO PULSING DOT. It was a green circle beside a count, which is the shape
// every generated dashboard has, and it said nothing the count did not. The
// progress itself carries the life instead: the filled part of the track
// has a light running through it while a step is outstanding, and stops
// when there is nothing left to wait for.
//
// Deliberately tiny. It is a reassurance, not a wizard.

// The label for whichever step is outstanding, so the header answers "what
// is it waiting on" and not just "how far in".
const nextLabel = (stages) => stages?.steps?.find((s) => s.id === stages.next)?.label ?? null;

export default function SessionTracker({ stages, paused = false, onClick = null }) {
  if (!stages?.steps?.length) return null;

  const waiting = nextLabel(stages);
  const done = Math.min(stages.done ?? 0, stages.total ?? 0);
  const settled = !paused && !waiting;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, title: 'Show the export card' } : {})}
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1 min-h-0 ${
        paused ? 'border-white/15 bg-diane-sunken' : 'session-pill border-diane-signal/30 bg-diane-sunken'
      } ${onClick ? 'hover:bg-diane-signal/10' : ''}`}
    >
      <span className={`text-[10px] tabular-nums ${paused ? 'text-white/40' : 'text-diane-signal'}`}>
        {done} of {stages.total}
      </span>

      {/**
       * ONE TRACK, SEGMENTED, not a row of loose dashes.
       *
       * Separate bars with a gap between them read as five unrelated marks
       * once they are all filled. A single rounded track with hairline
       * divisions reads as one thing being filled up, which is what it is.
       */}
      <span className="relative flex h-1 w-16 overflow-hidden rounded-full bg-white/10">
        <span
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            paused ? 'bg-white/25' : 'bg-diane-signal'
          } ${settled || paused ? '' : 'tracker-live'}`}
          style={{ width: `${Math.round((done / Math.max(stages.total, 1)) * 100)}%` }}
        />
        {/* The divisions, drawn over the fill so they mark the whole track
            rather than only the part that is done. */}
        {stages.steps.slice(1).map((s, i) => (
          <span
            key={s.id}
            className="absolute top-0 h-full w-px bg-diane-sunken"
            style={{ left: `${((i + 1) / stages.steps.length) * 100}%` }}
          />
        ))}
      </span>

      {(paused || waiting) && (
        <span className="text-[10px] text-white/40">{paused ? 'Paused' : waiting}</span>
      )}
    </Tag>
  );
}
