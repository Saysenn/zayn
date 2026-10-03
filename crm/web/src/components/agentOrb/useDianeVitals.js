import { useCallback, useRef, useState } from 'react';

// ***************************************************
// * What she is actually doing, measured
// ***************************************************
//
// The readouts beside the orb are REAL or they are a lie on a screen about
// money. Every number here comes from a turn that happened:
//
//   response  the last turn's round trip, measured here, not reported
//   accuracy  turns that came back with an answer, over turns attempted
//
// Nothing is seeded, smoothed toward a flattering number, or invented to
// fill the panel before the first question. Until she has answered one, the
// panel says so with a dash.
//
// Session-scoped on purpose: this is "how is she doing right now", not a
// service-level history, and a figure carried over from yesterday would be
// the wrong answer to the question the panel asks.

export function useDianeVitals() {
  const [turns, setTurns] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastMs, setLastMs] = useState(null);
  const totalMs = useRef(0);
  const [avgMs, setAvgMs] = useState(null);

  // Called once per finished turn, whichever way it ended.
  const record = useCallback((ok, ms) => {
    totalMs.current += ms;
    setLastMs(ms);
    setTurns((n) => {
      setAvgMs(Math.round(totalMs.current / (n + 1)));
      return n + 1;
    });
    if (!ok) setFailed((n) => n + 1);
  }, []);

  return {
    turns,
    failed,
    lastMs,
    avgMs,
    accuracy: turns ? ((turns - failed) / turns) * 100 : null,
    record,
  };
}
