import { useEffect, useRef } from 'react';

// ***************************************************
// * Escape closes it, and sometimes so does clicking away
// ***************************************************
//
// PORTALLED PANELS COUNT AS INSIDE. A Select renders its list into <body>
// (it has to, or a scroll box clips it), so a click on an option is not a
// click outside the popover that opened it. `data-portal-panel` is how such
// a panel says which it is.
//
// `outsideClick` IS OFF FOR ANYTHING WITH AN APPLY BUTTON. A popover that
// only commits on Apply is holding a draft, and an outside click throwing
// that draft away is a worse accident than a popover left open. The
// dashboard's filter panel is the case that proved it: picking a group shut
// the panel it was being picked in.

export default function useDismissable(open, onClose, { outsideClick = true } = {}) {
  const ref = useRef(null);
  // Held in a ref so a new closure on every render does not tear the
  // listeners down and put them back on each one.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const onDown = (event) => {
      if (ref.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-portal-panel]')) return;
      close.current();
    };
    // A dropdown open on top of this owns the Escape: it should shut, and
    // whatever it was opened from should stay.
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-portal-panel]')) return;
      close.current();
    };

    if (outsideClick) document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, outsideClick]);

  return ref;
}
