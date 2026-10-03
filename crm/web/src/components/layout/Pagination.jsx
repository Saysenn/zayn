import { useState } from 'react';
import Button from '../buttons/Button';
import { paginationPages } from './paginationPages';

export default function Pagination({ page, pageSize, total, onPageChange }) {
  const [target, setTarget] = useState('');
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const items = paginationPages(page, pageCount);

  function goToPage(event) {
    event.preventDefault();
    const requested = Number(target);
    if (!Number.isInteger(requested)) return;
    onPageChange(Math.min(pageCount, Math.max(1, requested)));
    setTarget('');
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 mt-3 flex-wrap text-sm">
      <span className="text-text-faint">{start}–{end} of {total}</span>
      <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto py-1">
        <Button variant="secondary" className="input-inline" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Prev
        </Button>
        {items.map((item) => (
          typeof item === 'number' ? (
            <Button
              key={item}
              variant={item === page ? 'primary' : 'secondary'}
              className="w-8 shrink-0 px-0"
              aria-label={`Go to page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ) : (
            <span key={item} className="w-5 shrink-0 text-center text-text-faint" aria-hidden="true">…</span>
          )
        ))}
        {pageCount > 10 && (
          <form className="ml-1 flex shrink-0 items-center gap-1" onSubmit={goToPage}>
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-text-muted">
              Go to
              <input
                type="number"
                min="1"
                max={pageCount}
                inputMode="numeric"
                className="h-8 w-14 min-h-0 px-1.5 py-0 text-center text-sm"
                aria-label={`Go to page, 1 to ${pageCount}`}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </label>
            <Button variant="secondary" type="submit" disabled={!target}>Go</Button>
          </form>
        )}
        <Button variant="secondary" className="input-inline" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
          Next
        </Button>
      </div>
    </nav>
  );
}
