import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Freezes the first N columns of a table, measuring where they actually
 * sit rather than being told.
 *
 * `position: sticky` only pins a cell once it knows its `left` offset,
 * and in a table that offset is the sum of the widths of every column
 * before it. Writing those as fixed rem values was the first attempt and
 * it broke immediately: a table renegotiates column widths against its
 * content, so a long group name pushed a column wider than the constant
 * assumed and a gap opened between the frozen columns. Forcing the widths
 * instead just moved the problem — it clipped real names.
 *
 * So the offsets are measured from the rendered header row and written
 * onto every cell. Content decides the widths, the widths decide the
 * offsets, and nothing is hardcoded.
 *
 * Re-measures on any size change (a ResizeObserver on the table catches
 * a window resize, a font load, a column growing when a longer value is
 * typed into it) and whenever `deps` change, which is how a new page of
 * rows gets its offsets.
 *
 * @param {number} count how many leading columns to freeze
 * @param {unknown[]} deps re-measure when these change (usually the rows)
 */
export function useStickyColumns(count, deps = []) {
  const ref = useRef(null);

  const measure = useCallback(() => {
    const table = ref.current;
    const headRow = table?.tHead?.rows?.[0];
    if (!table || !headRow) return;

    // Offsets come from the HEADER row specifically. Every row in a table
    // shares its column widths, and the header is the one row guaranteed
    // to exist even when the body is empty or still loading.
    const offsets = [];
    let running = 0;
    for (let i = 0; i < count; i += 1) {
      offsets.push(running);
      running += headRow.cells[i]?.getBoundingClientRect().width ?? 0;
    }

    for (const row of table.rows) {
      for (let i = 0; i < count; i += 1) {
        const cell = row.cells[i];
        if (cell) cell.style.left = `${offsets[i]}px`;
      }
    }
  }, [count]);

  useLayoutEffect(() => {
    measure();
    const table = ref.current;
    if (!table) return undefined;

    // The frozen columns only LOOK frozen once something has scrolled
    // under them. Sitting there with a border and a drop shadow while the
    // table is fully visible just draws a line down the middle of it for
    // no reason, so the marker is added on first horizontal scroll and
    // taken away again at the left edge.
    const scroller = table.closest('.table-wrap') ?? table.parentElement;
    const onScroll = () => {
      table.classList.toggle('is-scrolled-x', (scroller?.scrollLeft ?? 0) > 0);
    };
    onScroll();
    scroller?.addEventListener('scroll', onScroll, { passive: true });

    if (typeof ResizeObserver === 'undefined') {
      return () => scroller?.removeEventListener('scroll', onScroll);
    }
    // Observes the table itself, so this catches a column growing because
    // someone typed a longer value into a cell, not just window resizes.
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return () => {
      observer.disconnect();
      scroller?.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return ref;
}
