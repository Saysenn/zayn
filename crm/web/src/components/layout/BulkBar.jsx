import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '../buttons/Button';
import { ChevronIcon, CloseIcon } from '../icons';
import { countOf } from '../../helpers/pluralNoun';

// ***************************************************
// * The bulk bar: what you can do to the ticked rows
// ***************************************************

/**
 * ONE BAR FOR EVERY LIST. It rises from the bottom of the screen the
 * moment a row is ticked and leaves when none are, so the actions sit
 * beside the thing you just did instead of at the top of a long table.
 *
 * It writes its own height to `--bulkbar-h` on the root element. The
 * Toaster reads that and lifts itself above the bar, and pages pad their
 * bottom by it, so the last row is never hidden underneath.
 *
 *   <BulkBar count={sel.count} noun="deal" onClear={sel.clear}>
 *     <BulkAction icon={StopHandIcon} onClick={…}>Stop</BulkAction>
 *   </BulkBar>
 */
export default function BulkBar({ count, noun = 'row', onClear, children }) {
  const ref = useRef(null);
  const open = count > 0;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!open || !ref.current) {
      root.style.removeProperty('--bulkbar-h');
      return undefined;
    }
    const write = () => root.style.setProperty('--bulkbar-h', `${ref.current.offsetHeight + 16}px`);
    write();
    const ro = new ResizeObserver(write);
    ro.observe(ref.current);
    return () => { ro.disconnect(); root.style.removeProperty('--bulkbar-h'); };
  }, [open]);

  // Escape clears, the same key that closes every other layer.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // Not while one of the bar's own menus or a dialog is open: Escape
      // closes THAT, and must not also throw the selection away.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], .bulk-menu')) return;
      onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClear]);

  if (!open) return null;

  return createPortal(
    <div className="bulk-bar-wrap" role="region" aria-label="Bulk actions">
      <div ref={ref} className="bulk-bar">
        <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-text tabular-nums">
          {countOf(count, noun)} selected
        </span>
        <span className="hidden sm:block h-5 w-px bg-border" aria-hidden="true" />
        <div className="bulk-bar-actions">{children}</div>
        <Button size="sm" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
          <CloseIcon width={16} height={16} />
          <span className="hidden sm:inline">Clear</span>
        </Button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A bar button: icon and label, `sm`, quiet unless it ends or destroys
 * something. `danger` is for Delete and Stop, told apart by their icons
 * (bin vs palm). `busy` is optional: bulk writes are optimistic, so the
 * bar's buttons are never held disabled waiting for the server.
 */
export function BulkAction({ icon: Icon, variant = 'quiet', busy = false, children, ...props }) {
  return (
    <Button size="sm" variant={variant} phase={busy ? 'working' : 'idle'} disabled={busy || props.disabled} {...props}>
      {Icon && <Icon width={16} height={16} />}
      {children}
    </Button>
  );
}

/**
 * A bar button that opens a short list upward: Paid → Yes / No.
 *
 * `hint` is the faint line at the top, "2 yes · 1 no", so a mixed
 * selection is visible BEFORE you pick, not discovered afterwards.
 *
 *   options: [{ label, onSelect, icon?, variant? }]
 */
export function BulkMenu({ icon: Icon, label, hint, options, busy = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const menu = useRef(null);

  // PORTALLED AND FIXED, measured off the button. The bar slides in with a
  // transform, and a transformed ancestor makes `fixed` relative to IT
  // rather than the screen: the menu landed a bar's width away. And the
  // action row scrolls sideways on a phone, which would clip it anyway.
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 184)),
      bottom: window.innerHeight - r.top + 6,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrap} className="relative shrink-0">
      <BulkAction icon={Icon} busy={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronIcon width={14} height={14} className={`transition-transform ${open ? 'rotate-90' : '-rotate-90'}`} />
      </BulkAction>
      {open && createPortal(
        <div ref={menu} role="menu" className="bulk-menu" style={pos ?? { visibility: 'hidden' }}>
          {hint && <p className="px-2.5 pb-1 pt-0.5 text-xs text-text-faint">{hint}</p>}
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitem"
              className={`bulk-menu-item ${o.variant === 'danger' ? 'text-danger' : ''}`}
              onClick={() => { setOpen(false); o.onSelect(); }}
            >
              {o.icon && <o.icon width={15} height={15} />}
              {o.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
