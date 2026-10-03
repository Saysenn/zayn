import { useEffect, useState } from 'react';

// Search boxes now drive a server query (pagination made client-side
// filtering incorrect — see docs/todo.md), so typing must not fire one
// request per keystroke. 300ms is short enough to still feel instant.
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
