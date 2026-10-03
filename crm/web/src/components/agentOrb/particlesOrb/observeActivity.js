// ***************************************************
// * Whether an element is worth animating: on screen, in a visible tab
// ***************************************************

/**
 * Calls `onChange(active)` when the element scrolls out of view or the tab
 * is hidden, and back. Returns the cleanup.
 */
export function observeActivity(el, onChange) {
  let inView = true;
  let pageVisible = document.visibilityState === 'visible';
  let active = inView && pageVisible;

  const sync = () => {
    const next = inView && pageVisible;
    if (next === active) return;
    active = next;
    onChange(next);
  };

  const observer = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1]?.isIntersecting ?? true;
    sync();
  });
  observer.observe(el);

  const onVisibility = () => {
    pageVisible = document.visibilityState === 'visible';
    sync();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
