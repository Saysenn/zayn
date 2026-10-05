// ***************************************************
// * The shell both detail pages stand in
// ***************************************************
//
// A person and a company are the same shape of page: one record, its own
// fields, and the deals underneath it. They had the same structure written
// out twice and an identical `Stat` function copied into both, which is
// two files to edit for one decision about how a detail page looks.
//
// SEPARATION OF CONCERNS IS THE POINT of the split, not tidiness:
//
//   main   WHAT THIS RECORD IS, and what it holds. The identity fields and
//          the list of deals: the wide things, the ones you edit.
//   side   WHAT IT COMES TO. The money and the details you read rather
//          than change. Narrow, so it can be scanned down.
//
// A page decides what goes in each; this only decides where they sit.

// One column until lg. Two columns is a reading layout, and below 1024px
// the side column is too narrow to read, so it goes under the main one
// rather than being squeezed beside it.
export function DetailGrid({ main, side, overview, summary, records, supporting }) {
  if (overview || summary || records || supporting) {
    return (
      <div className="grid items-start gap-3 xl:grid-cols-4">
        <div className="xl:col-span-3">{overview}</div>
        <div>{summary}</div>
        {supporting && (
          <div className="grid gap-3 md:grid-cols-2 xl:col-span-4">{supporting}</div>
        )}
        {records && <div className="xl:col-span-4">{records}</div>}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">{main}</div>
      <div className="space-y-4">{side}</div>
    </div>
  );
}

/**
 * A bordered card with a small caps header.
 *
 * `action` is for a control that belongs to the card rather than the page.
 * It sits in the header so the control and its content stay together.
 *
 * `flush` is for a card whose body draws its own padding: a table or a card
 * list runs edge to edge, and 16px of padding around a table is a gutter
 * that the table's own cells then repeat.
 *
 * `fill` stretches it to its grid row, so cards side by side end level.
 */
export function DetailCard({ title, action, flush = false, highlighted = false, fill = false, children }) {
  return (
    // `overflow-hidden` is what makes the header's own background stop at
    // the radius. Without it the card is round and its header is square.
    <section className={`overflow-hidden rounded-lg border border-border bg-surface shadow-sm ${fill ? 'h-full' : ''}`}>
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-1.5 ${
        // `highlighted` is a TINT, never a solid fill: the card says "this
        // one leads" without shouting over the rest of the page.
        highlighted ? 'border-border bg-accent-tint/50' : 'border-border bg-surface-sunken/70'
      }`}>
        <h2 className={`text-xs font-semibold uppercase tracking-wide ${
          highlighted ? 'text-accent-strong' : 'text-text-faint'
        }`}>{title}</h2>
        {action}
      </div>
      <div className={flush ? '' : 'p-3'}>{children}</div>
    </section>
  );
}

// A label above a value. The label is the quiet one: you are scanning for
// the value, and a row of bold captions is a row of things to read past.
export function Stat({ label, value, lead = false }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${lead ? 'text-lg' : 'text-xs'}`}>{value}</p>
    </div>
  );
}
