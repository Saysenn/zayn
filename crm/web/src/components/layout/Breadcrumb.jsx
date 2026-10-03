import { Link } from 'react-router-dom';

/**
 * Where you are, and the way back.
 *
 * Replaces the back-arrow button that used to sit above detail pages. A
 * lone arrow says "back" but not back to WHAT, and it competes with the
 * browser's own back button for the same job. "People › Drew" answers
 * both at once: it names the place you'd return to, and the name itself
 * is the link.
 *
 * The last crumb is the current page and is never a link — a link to
 * where you already are is the thing that makes breadcrumbs feel broken.
 *
 * @param {{label: string, to?: string}[]} items
 */
export default function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex items-center gap-1.5 text-sm flex-wrap">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {last || !item.to ? (
                <span className={last ? 'font-semibold text-text' : 'text-text-muted'} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="text-text-muted hover:text-text hover:underline">
                  {item.label}
                </Link>
              )}
              {!last && <span className="text-text-faint select-none">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
