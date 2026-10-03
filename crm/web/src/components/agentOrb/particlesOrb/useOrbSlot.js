import { useEffect, useRef, useState } from 'react';

// The particles orb draws at a pixel size, so its slot is measured and it
// fills `fill` times the slot's shorter side. Shared by every screen that shows it.
export function useOrbSlot(fill) {
  const slotRef = useRef(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    const measure = () => setSize(Math.floor(Math.min(slot.clientWidth, slot.clientHeight) * fill));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [fill]);
  return [slotRef, size];
}
