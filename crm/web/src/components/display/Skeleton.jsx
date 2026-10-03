// ***************************************************
// * One placeholder shape, reused wherever a real value will land
// ***************************************************
//
// Sized via className at the call site rather than a dozen size variants.
//
// THE LOOK LIVES IN `.skeleton` (index.css), not here: the sweep, the tone
// and the radius are one decision and a component that reimplemented any of
// them would drift from the rest. See that block for why it sweeps rather
// than pulses, and why the tone is `border-strong` rather than the sunken
// wash that was invisible on a white card.
//
// ROUNDED, ALWAYS. A placeholder stands in for content that is itself in a
// rounded card, an input or a pill; square blocks read as a broken layout
// rather than as something arriving. `pill` is for the short text lines,
// where a 6px radius on a 10px bar still looks square.
export function Skeleton({ className = '', pill = false }) {
  return <div className={`skeleton ${pill ? '!rounded-full' : ''} ${className}`} />;
}

// A table body's worth of placeholder rows, matching however many columns
// the real table has, so the skeleton doesn't jump around once data lands.
//
// The widths VARY down the row. Identical bars in every cell read as a
// rendered grid rather than as text arriving, and the eye stops seeing it
// as temporary.
const CELL_WIDTHS = ['max-w-32', 'max-w-24', 'max-w-28', 'max-w-20'];

export function TableSkeleton({ columns, rows = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <td className="td" key={c}>
              <Skeleton pill className={`h-3.5 w-full ${CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// A chat person-list's worth of placeholder rows.
export function ListSkeleton({ rows = 8 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5">
          <Skeleton pill className="h-3.5 w-24" />
          <Skeleton pill className="h-2.5 w-16" />
        </div>
      ))}
    </>
  );
}

// A card grid's worth of placeholders, card shaped rather than row shaped,
// so the grid does not reflow the moment the data lands.
//
// `rounded-lg` matches RecordCard, which is what these become.
export function CardSkeleton({ cards = 10 }) {
  return (
    <>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <Skeleton pill className="h-4 w-28" />
          <Skeleton pill className="h-3 w-20" />
          <Skeleton className="mt-1 h-5 w-24" />
          <Skeleton pill className="mt-2 h-3 w-full" />
          <Skeleton pill className="h-3 w-full" />
          <Skeleton pill className="h-3 w-2/3" />
        </div>
      ))}
    </>
  );
}

// A handful of alternating bubbles while a thread loads.
//
// `rounded-xl`, because a message bubble is the roundest thing in the app
// and a 6px placeholder under one reads as a different component.
export function ChatSkeleton() {
  const widths = ['w-40', 'w-56', 'w-32', 'w-48'];
  return (
    <div className="flex flex-col gap-2">
      {widths.map((w, i) => (
        <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
          <Skeleton className={`h-9 !rounded-xl ${w}`} />
        </div>
      ))}
    </div>
  );
}
