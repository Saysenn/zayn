import Select from '../forms/Select';

/**
 * FILTER BY A FIGURE, BETWEEN TWO BOUNDS.
 *
 * "Everyone on more than 1,000." "Everyone whose payable amount came out
 * between nothing and fifty." Those are the questions a payout run is
 * actually checked with, and until now the only way to ask one was to sort
 * a column by eye.
 *
 * ONE COMPONENT, ANY NUMERIC COLUMN. The caller says which fields it
 * offers; this knows nothing about money or about the master sheet, so the
 * next page that needs a figure filter reuses it rather than growing a
 * second one that behaves almost the same.
 *
 * EITHER BOUND ALONE IS A REAL FILTER. "More than 1,000" needs no upper
 * bound and "under 50" needs no lower one, so neither is required and an
 * empty box means unbounded rather than zero. That distinction matters
 * here: 0 is a real payable amount, and a filter that read a blank box as
 * 0 would quietly exclude every row that earns nothing, which is exactly
 * the set somebody is usually hunting for.
 *
 * NOTHING IS APPLIED UNTIL A FIELD IS CHOSEN. A min with no column to
 * compare it against is not a filter, it is half a sentence.
 *
 * @param {{value:string,label:string}[]} fields the columns on offer
 * @param {{field?:string,min?:string,max?:string}} value
 * @param {(next:object) => void} onChange given the whole object, so the
 *   caller stores one thing and a cleared filter is one comparison.
 */
export default function NumberRangeFilter({
  fields, value, onChange, placeholder = 'All amounts',
}) {
  const { field = '', min = '', max = '' } = value ?? {};

  function set(patch) {
    const next = { field, min, max, ...patch };
    // Clearing the field clears the bounds with it. Leaving 1000 sitting in
    // a box that now compares against nothing is a filter that looks armed
    // and does nothing.
    if (!next.field) return onChange({});
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        size="sm"
        className="w-44"
        value={field}
        onChange={(v) => set({ field: v ?? '' })}
        options={fields}
        placeholder={placeholder}
      />
      {/* The bounds appear only once there is something to bound. Two empty
          number boxes sitting beside every other filter is two controls
          explaining nothing. */}
      {field && (
        <>
          <input
            type="number"
            inputMode="decimal"
            className="input-inline w-24"
            placeholder="Min"
            aria-label="Minimum"
            value={min}
            onChange={(e) => set({ min: e.target.value })}
          />
          <span className="text-xs text-text-faint">to</span>
          <input
            type="number"
            inputMode="decimal"
            className="input-inline w-24"
            placeholder="Max"
            aria-label="Maximum"
            value={max}
            onChange={(e) => set({ max: e.target.value })}
          />
        </>
      )}
    </div>
  );
}
