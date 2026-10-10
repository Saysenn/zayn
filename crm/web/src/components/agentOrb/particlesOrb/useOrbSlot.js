import { useEffect, useState } from 'react';

// The particles orb draws at a pixel size, so its slot is measured and it
// fills `fill` times the slot's shorter side. Shared by every screen that shows it.
// A callback ref, not an object ref: the slot can appear AFTER mount (the
// command center opened in V2, then switched to V1), and must be measured then.
export function useOrbSlot(fill) {
  const [slot, slotRef] = useState(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    if (!slot) return undefined;
    const measure = () => setSize(Math.floor(Math.min(slot.clientWidth, slot.clientHeight) * fill));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot, fill]);
  return [slotRef, size];
}
