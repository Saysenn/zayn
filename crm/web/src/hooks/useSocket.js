import { useEffect, useRef } from 'react';
import { socket } from '../configs/socket.config';

// Connects once for the whole authenticated app (mounted in Layout) and
// disconnects when the admin signs out / navigates away from it. Individual
// pages use useSocketEvent below rather than managing connection state
// themselves.
export function useSocketConnection() {
  useEffect(() => {
    socket.connect();
    return () => socket.disconnect();
  }, []);
}

// Subscribe to one event for the lifetime of a component. The listener
// itself is only attached once per event name — handler is called through a
// ref so a new function identity every render (the common case: an inline
// closure over local state) never misses an update and never causes a
// resubscribe storm.
export function useSocketEvent(event, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (...args) => handlerRef.current(...args);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [event]);
}
