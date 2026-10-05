import Button from '../buttons/Button';
import { AlertCircleIcon } from '../icons';

// ***************************************************
// * Nothing here, and something broke: one look each
// ***************************************************

/**
 * THE EMPTY STATE, the same on every list. It had four looks (a dashed
 * box, an icon tile, plain text, a bare table row), so "is this empty or
 * still loading" read differently on every page.
 *
 * `asRow` with `colSpan` puts it inside a table body, so a table and a
 * card grid say "nothing here" in exactly the same words and shape.
 */
export function EmptyState({ icon: Icon, title = 'Nothing here yet', hint, action, asRow = false, colSpan = 1 }) {
  const body = (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      {Icon && (
        <span className="mb-2 grid h-9 w-9 place-items-center rounded-full bg-surface-sunken text-text-muted">
          <Icon width={18} height={18} />
        </span>
      )}
      <p className="m-0 text-sm font-semibold text-text">{title}</p>
      {hint && <p className="m-0 mt-0.5 max-w-sm text-xs text-text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
  if (asRow) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-0">{body}</td>
      </tr>
    );
  }
  return <div className="rounded-lg border border-border bg-surface">{body}</div>;
}

/**
 * THE ERROR STATE. A red tint with the reason and, when there is one, a
 * way to try again. It was grey text on some pages, which read as "empty"
 * rather than "broken", and missing on others.
 */
export function ErrorState({ error, title = "Couldn't load this", onRetry, asRow = false, colSpan = 1 }) {
  if (!error) return null;
  const body = (
    <div className="flex items-start gap-2.5 rounded-lg bg-danger-tint px-3 py-2.5 text-sm text-danger" role="alert">
      <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold">{title}</p>
        {error?.message && <p className="m-0 mt-0.5 text-xs opacity-90">{error.message}</p>}
      </div>
      {onRetry && <Button size="xs" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
  if (asRow) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-2">{body}</td>
      </tr>
    );
  }
  return <div className="mb-3">{body}</div>;
}
