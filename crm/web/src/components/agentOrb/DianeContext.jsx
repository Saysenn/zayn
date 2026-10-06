import {
  createContext, useContext, useEffect, useMemo, useState,
} from 'react';
import { useAiStatus, useRecheckAi } from '../../hooks/useAiStatus';
import AiLockedDialog from '../modals/AiLockedDialog';

/**
 * Diane's working context — which CRM sheet she's currently operating on.
 *
 * This is NOT navigation. Selecting "Cash" doesn't take you to the cash
 * page; it tells Diane that's the workspace she should act in. The value
 * is sent with every agent turn, and the backend hands her only that
 * workspace's tools (crm/api/v1/agent/contexts.js), so acting on the
 * wrong sheet isn't something she can do by mistake.
 *
 * Lifted to app level rather than owned by a page because Diane is now
 * global: one instance, one conversation, reachable from anywhere via the
 * header button. A page-owned context would reset every time you moved.
 */
const DianeCtx = createContext(null);

/**
 * WHAT SHE IS FOCUSED ON, one major area at a time so figures never mix.
 * The admin's call 2026-10-06: the master sheet now (deals, people,
 * companies: everything she does today), expenses and debts to come. The
 * two not built yet are shown, greyed, as coming soon.
 */
export const CONTEXTS = Object.freeze([
  { key: 'master-sheet', label: 'Master sheet' },
  { key: 'expenses', label: 'Expenses', soon: true },
  { key: 'debts', label: 'Debts', soon: true },
]);
const DEFAULT_CONTEXT = 'master-sheet';
const CONTEXT_KEY = 'diane.context';
function savedContext() {
  try {
    const saved = sessionStorage.getItem(CONTEXT_KEY);
    return CONTEXTS.some((c) => c.key === saved && !c.soon) ? saved : DEFAULT_CONTEXT;
  } catch { return DEFAULT_CONTEXT; }
}

const OPEN_KEY = 'diane-open';
function wasOpen() {
  try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

export function DianeProvider({ children }) {
  const [context, setContextState] = useState(savedContext);
  // Only an area that is built can be picked; the choice stays for the tab.
  const setContext = (key) => {
    if (!CONTEXTS.some((c) => c.key === key && !c.soon)) return;
    setContextState(key);
    try { sessionStorage.setItem(CONTEXT_KEY, key); } catch { /* storage off: it resets on refresh */ }
  };
  // A REFRESH KEEPS HER OPEN. It dropped the admin back on the page
  // underneath, mid conversation. Per tab, like the conversation itself.
  const [open, setOpen] = useState(wasOpen);
  // Once true, stays true — the overlay keeps rendering (hidden via its
  // own `open` prop) so the conversation survives closing and reopening,
  // and Three.js never loads until Diane is actually opened once.
  const [everOpened, setEverOpened] = useState(wasOpen);
  useEffect(() => {
    try { sessionStorage.setItem(OPEN_KEY, open ? '1' : ''); } catch { /* storage off: a refresh closes her */ }
  }, [open]);

  // LOCKED HERE, where every way in passes: no key or no credit shows why instead.
  const ai = useAiStatus();
  const recheckAi = useRecheckAi();
  const [showLock, setShowLock] = useState(false);

  // A lock learned mid conversation closes her and says why.
  useEffect(() => {
    if (ai.locked && open) {
      setOpen(false);
      setShowLock(true);
    }
  }, [ai.locked, open]);

  const value = useMemo(
    () => ({
      context,
      setContext,
      open,
      openDiane: () => {
        if (ai.locked) { setShowLock(true); return; }
        setEverOpened(true);
        setOpen(true);
      },
      closeDiane: () => setOpen(false),
      everOpened,
      ai,
      recheckAi,
    }),
    [context, open, everOpened, ai, recheckAi],
  );

  return (
    <DianeCtx.Provider value={value}>
      {children}
      {showLock && <AiLockedDialog reason={ai.reason} onClose={() => setShowLock(false)} />}
    </DianeCtx.Provider>
  );
}

export function useDiane() {
  const ctx = useContext(DianeCtx);
  if (!ctx) throw new Error('useDiane must be used inside DianeProvider');
  return ctx;
}
