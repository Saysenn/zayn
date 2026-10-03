// ***************************************************
// * TEMPORARY: the particles orb in every mode, for his review
// ***************************************************
// Deleted once he has seen it, with its route in App.jsx.

import { useState } from 'react';
import ParticlesOrb from '../components/agentOrb/particlesOrb/ParticlesOrb';
import OrbStatus from '../components/agentOrb/particlesOrb/OrbStatus';
import { ALL_ORB_STATES, ORB_STATE } from '../components/agentOrb/particlesOrb/orbState';
import { DIANE } from '../configs/dianeTheme';

const SMALL = 180;
const LARGE = 360;

export default function OrbTestPage() {
  const [picked, setPicked] = useState(ORB_STATE.speaking);

  return (
    <div className="min-h-screen p-6 text-white" style={{ background: DIANE.void }}>
      <h1 className="mb-1 text-xl font-semibold">Particles orb</h1>
      <p className="mb-6 text-sm text-white/60">Every mode side by side, then one large orb you can switch.</p>

      <div className="mb-10 flex flex-wrap gap-6">
        {ALL_ORB_STATES.map((s) => (
          <div key={s} className="flex flex-col items-center gap-2">
            <ParticlesOrb state={s} size={SMALL} label={`Orb, ${s}`} />
            <OrbStatus state={s} className="text-sm text-white/80" />
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-2">
          {ALL_ORB_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPicked(s)}
              className={`rounded-full border px-3 py-1 text-sm ${
                picked === s ? 'border-white bg-white text-black' : 'border-white/30 bg-transparent text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <ParticlesOrb state={picked} size={LARGE} label={`Orb, ${picked}`} />
        <OrbStatus state={picked} className="text-base text-white/80" />
      </div>
    </div>
  );
}
