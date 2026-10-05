import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import Button from '../buttons/Button';
import { CloseIcon } from '../icons';

// `wide` is for form modals with more fields than fit in one readable
// column — the master sheet's row editor has 20+. Fixed widths rather than
// a free-form size prop: every modal in the app should still look like it
// came from the same place.
//
// `size="table"` is the third and last one, added 2026-09-17 for the
// monthly review: `wide` is 3xl, and that panel holds a nine column table
// AND a row of five controls, so the table scrolled sideways under a header
// that had wrapped to two lines. A dialog narrower than its own content is
// the one case the two sizes could not cover.
const WIDTHS = {
  default: 'sm:max-w-md',
  wide: 'sm:max-w-3xl',
  table: 'sm:max-w-6xl',
};

// `tone` is the same reasoning applied to colour. Diane's command center is
// near black and the CRM is white, so a dialog opened from inside her would
// arrive as a white box on a dark screen. Two tones, not a theme system:
// there are exactly two worlds in this app and a free-form palette prop
// would let a third appear without anybody deciding to make one.
const TONES = {
  crm: {
    panel: 'bg-surface sm:border sm:border-border',
    head: 'border-b border-border bg-surface-sunken/70',
    title: 'text-text',
    // Null: the CRM's close is the shared quiet icon Button.
    close: null,
    // The body is the one scrolling region, so it is the one that drew the
    // platform's full width bar down the side of a dialog.
    scroll: 'scroll-slim',
  },
  diane: {
    panel: 'bg-diane-panel sm:border sm:border-diane-line/35',
    head: 'border-b border-diane-line/25',
    title: 'text-diane-signal',
    close: 'border-0 bg-transparent text-diane-dim hover:text-diane-signal',
    // Same slim bar, her green. See `.diane-scroll` in index.css.
    scroll: 'scroll-slim diane-scroll',
  },
};

/**
 * `title` may be a node, so a caller can put an icon beside the words.
 * `aria-label` cannot: an element there serialises to "[object Object]" and
 * the dialog announces itself as that. `ariaLabel` is the plain string for
 * anything that passes a node, and a string title needs neither.
 */
export default function Modal({
  title, ariaLabel, onClose, wide = false, size, tone = 'crm', centered = false, children,
}) {
  // `size` wins where it is given. `wide` is what every existing caller
  // passes and keeps meaning exactly what it meant.
  const width = WIDTHS[size] ?? (wide ? WIDTHS.wide : WIDTHS.default);
  const skin = TONES[tone] ?? TONES.crm;
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // INTO <body>, not where the dialog was opened. Rendered in place, any
  // ancestor with a transform, a filter or a backdrop blur (the sticky
  // header has one) becomes what `fixed inset-0` is measured against, and
  // the backdrop stopped short of the top of the window with a strip of
  // undimmed page above it.
  return createPortal(
    <div
      // z-50, above the table's sticky cells.
      //
      // The layers in this app, lowest first: sticky column 10, sticky
      // header 20, the frozen corner where they cross 30, a review
      // tooltip 40, this 50, toasts 60. At z-20 a frozen column painted
      // straight over an open dialog, which is how this was found.
      // FULL SCREEN ON A PHONE, a centred box from `sm` up.
      //
      // A floating dialog with a margin all round wastes the two things a
      // 375px screen has least of, width and height, so a six field form
      // scrolled inside a box that was itself scrolling. Bottom-aligned
      // below `sm` so the sheet rises from the thumb rather than the
      // forehead.
      // `centered` keeps a short notice in the middle on a phone too, never a sheet.
      className={`fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-sm ${centered ? 'items-center p-4' : 'items-end sm:items-center sm:p-4'}`}
      onClick={onClose}
    >
      <div
        /* Rounded only from sm up, and only at the top below it: on a
           phone the dialog is a sheet flush to the bottom edge, and
           rounding the bottom corners would float it off the screen. */
        className={`flex w-full flex-col overflow-hidden shadow-2xl
          ${centered ? 'rounded-xl' : 'rounded-t-xl sm:rounded-xl'}
          max-h-full sm:max-h-[calc(100vh-2rem)]
          ${skin.panel}
          ${width}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {/* shrink-0 so the title stays put and only the body scrolls. On a
            phone the dialog is the whole screen, and a heading that
            scrolls away leaves you in a form with no idea what it is. */}
        <div className={`flex shrink-0 items-center justify-between px-4 py-3 ${skin.head}`}>
          <h2 className={`truncate pr-2 text-base font-bold sm:text-lg ${skin.title}`}>{title}</h2>
          {/* The shared icon, never a ✕ glyph, which sat at the font's
              weight rather than the 2px stroke every other icon has. Diane
              keeps her own bare button: btn-quiet's grey fill would land
              on her near-black panel. */}
          {skin.close ? (
            <button
              type="button"
              className={`min-h-0 shrink-0 p-1.5 ${skin.close}`}
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon width={16} height={16} />
            </button>
          ) : (
            <Button size="icon" className="shrink-0" onClick={onClose} aria-label="Close">
              <CloseIcon width={16} height={16} />
            </Button>
          )}
        </div>
        {/* The one scrolling region. It used to be the whole dialog, which
            scrolled the header away with it.

            The sheet covers the bottom nav (z 50 over 10), so it clears only
            the phone's home bar: reserving the nav's height was dead space. */}
        <div className={`flex-1 overflow-y-auto p-4 pb-[calc(theme(spacing.safebottom)+1rem)] sm:pb-4 ${skin.scroll}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
