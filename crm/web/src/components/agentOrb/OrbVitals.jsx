import Heartbeat from './Heartbeat';

// ***************************************************
// * DIANE CORE, the readout beside the orb
// ***************************************************
//
// EVERY FIGURE ON THIS PANEL IS MEASURED. Nothing is decoration dressed as
// telemetry: the segments are her mode and her live amplitude, response is
// the last turn's own round trip, accuracy is turns answered over turns
// attempted (see useDianeVitals.js). Before the first turn it says so with
// a dash rather than opening on a flattering number.
//
// Hidden below xl. It is a column of its own, and on a narrow screen there
// is no room for one without taking the width off her.

// How much of the core is lit in each state. Not arbitrary: idle is one
// segment because she is holding, speaking is all five because everything
// she has is going out.
const CORE_FOR = { idle: 1, building: 3, listening: 4, thinking: 4, speaking: 5 };
const SEGMENTS = 5;

function SegmentRow({ lit, dim = false }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 transition-colors duration-150 ${
            i < lit
              ? dim ? 'bg-diane-dim' : 'bg-diane-signal'
              : 'bg-diane-line/25'
          }`}
        />
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[0.55rem] uppercase tracking-[0.22em] text-diane-dim m-0">{label}</p>
      <p className="text-base font-bold tabular-nums text-diane-signal m-0 leading-tight">{value}</p>
    </div>
  );
}

// NOT a zero and not a dash. Before the first turn there is no reading,
// and "0.00s" would be a figure nobody measured.
const NO_READING = 'not yet';
const seconds = (ms) => (ms === null ? NO_READING : `${(ms / 1000).toFixed(2)}s`);
const percent = (n) => (n === null ? NO_READING : `${n.toFixed(1)}%`);

export default function OrbVitals({ mode, level, vitals, active, className = '' }) {
  // The live amplitude, as a share of the segments. Real: it is the same
  // `level` the orb and the input meter read.
  const signalLit = Math.min(SEGMENTS, Math.round(level * SEGMENTS * 1.4));

  return (
    <div className={`flex flex-col gap-5 select-none ${className}`}>
      <div>
        <p className="text-[0.55rem] uppercase tracking-[0.22em] text-diane-dim m-0 mb-2">
          Diane core
        </p>
        <div className="flex flex-col gap-1.5">
          <SegmentRow lit={CORE_FOR[mode] ?? 1} />
          <SegmentRow lit={signalLit} dim />
        </div>
      </div>

      <Heartbeat mode={mode} level={level} active={active} className="-ml-1" />

      <Stat label="Signal" value={percent(level * 100)} />
      <Stat label="Response" value={seconds(vitals.lastMs)} />
      <Stat label="Accuracy" value={percent(vitals.accuracy)} />

      {/* The denominator, small. An accuracy of 100% over one turn and over
          forty are different claims, and a percentage alone hides which. */}
      <p className="text-[0.55rem] uppercase tracking-[0.18em] text-diane-dim/75 m-0 -mt-3">
        {vitals.turns === 1 ? '1 turn' : `${vitals.turns} turns`}
        {vitals.failed > 0 && ` · ${vitals.failed} lost`}
      </p>
    </div>
  );
}
