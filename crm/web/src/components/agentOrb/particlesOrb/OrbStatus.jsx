import { ORB_STATE } from './orbState';

// What each mode says, so a state is never signalled by colour alone.
const STATUS_TEXT = {
  [ORB_STATE.idle]: 'Idle',
  [ORB_STATE.connecting]: 'Connecting',
  [ORB_STATE.listening]: 'Listening',
  [ORB_STATE.thinking]: 'Thinking',
  [ORB_STATE.speaking]: 'Speaking',
  [ORB_STATE.error]: 'Error',
  [ORB_STATE.disabled]: 'Muted',
};

/** The orb's mode in words, announced politely to a screen reader. */
export default function OrbStatus({ state, className }) {
  return (
    <span role="status" aria-live="polite" aria-atomic="true" className={className}>
      {STATUS_TEXT[state] ?? STATUS_TEXT[ORB_STATE.idle]}
    </span>
  );
}
