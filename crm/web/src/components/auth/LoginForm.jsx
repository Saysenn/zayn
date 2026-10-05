import { lazy, Suspense, useEffect, useState } from 'react';
import { useLogin, useVerifyCode, LOGIN_TRANSITION_MS } from '../../hooks/useAuth';
import DianeEnvironment from '../agentOrb/DianeEnvironment';
import HoloFrame from '../agentOrb/HoloFrame';
import { useDianePalette } from '../agentOrb/DianePalette';
import { ShieldIcon, UserIcon, LockIcon, CheckIcon } from '../icons';

// Its own orb, NOT the CRM's ParticleOrb — user's own call, and the two
// are meant to stay independent: the login orb is Diane dormant behind the
// door, the CRM one is Diane working. Tuning either must never restyle the
// other. Lazy because it pulls in Three.js, which the login page has no
// other reason to download.
const LoginOrb = lazy(() => import('../agentOrb/LoginOrb'));

// The three drawings the shared set has no equivalent for (eye, eye-off,
// key, the submit arrow). Same stroke and corners as icons/index.jsx's BASE,
// so they sit beside its UserIcon and LockIcon at one weight.
const ICON = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const EyeIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const ArrowIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const KeyIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <circle cx="8" cy="15" r="4" />
    <path d="M10.85 12.15L20 3M17 6l2.5 2.5M14 9l2.5 2.5" />
  </svg>
);

// Signing in isn't a spinner: Diane herself becomes the loading state,
// getting brighter and busier while the request is in flight, then pulsing
// once on success. These are the phases that drives.
const PHASE = { IDLE: 'idle', AUTHENTICATING: 'authenticating', SUCCESS: 'success' };

// TWO STEPS ON ONE CARD, not two routes. The pending ticket lives in this
// component's state, so a refresh mid flow correctly drops back to the
// start rather than stranding somebody on a code screen with nothing
// behind it. A second route would need its own guard and its own answer
// for the back button to get to the same place.
const STEP = { CREDENTIALS: 'credentials', CODE: 'code' };

// HIDDEN, NOT DELETED, and hidden because it lies. `remember` is component
// state that is never sent anywhere, so the box promises a longer session
// and delivers nothing. The wiring below is untouched: show it again by
// flipping this, once the cookie lifetime actually follows it.
const SHOW_REMEMBER = false;

// How long the fields fade out before the other set fades in.
const SWAP_MS = 220;

export default function LoginForm() {
  // The chosen theme's palette. See configs/themes.js.
  const palette = useDianePalette();
  const { tint } = palette;
  const { mutate: login, isPending: loggingIn } = useLogin();
  const { mutate: verify, isPending: verifying } = useVerifyCode();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(STEP.CREDENTIALS);
  const [ticket, setTicket] = useState(null);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [swapping, setSwapping] = useState(false);
  // One message rather than each mutation's own error object: a burned
  // ticket sends you back to the first step and the reason has to survive
  // the trip, which an error tied to the code step would not.
  const [message, setMessage] = useState('');

  const busy = loggingIn || verifying;

  // The card fades up a beat after the orb starts assembling, so the two
  // don't arrive at once and flatten each other.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 260);
    return () => clearTimeout(t);
  }, []);

  function goToStep(next) {
    setSwapping(true);
    setTimeout(() => {
      setStep(next);
      setSwapping(false);
    }, SWAP_MS);
  }

  function restart(why) {
    setTicket(null);
    setCode('');
    setPassword('');
    setMessage(why ?? '');
    goToStep(STEP.CREDENTIALS);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (busy || phase === PHASE.SUCCESS) return;
    return step === STEP.CREDENTIALS ? submitCredentials() : submitCode();
  }

  function submitCredentials() {
    if (!username || !password) return;
    setPhase(PHASE.AUTHENTICATING);
    login(
      { username, password },
      {
        onSuccess: (data) => {
          // NOT the success pulse. The password is only half the door, and
          // Diane celebrating here would say "you're in" one step early.
          // She goes back to resting while the code is asked for.
          setPhase(PHASE.IDLE);
          setMessage('');
          setTicket(data.ticket);
          goToStep(STEP.CODE);
        },
        onError: (err) => {
          // Deliberately NOT a red orb. She stays green; the card carries
          // the actual error. Recolouring her for a typo'd password would
          // make a routine mistake feel like a system fault.
          setPhase(PHASE.IDLE);
          setPassword('');
          setMessage(err.message);
        },
      },
    );
  }

  function submitCode() {
    if (!code || !ticket) return;
    setPhase(PHASE.AUTHENTICATING);
    verify(
      { ticket, code },
      {
        onSuccess: () => {
          // Now she pulses and the card recedes; useVerifyCode holds the
          // session flip for LOGIN_TRANSITION_MS so this actually gets to
          // play before RedirectIfAuthed takes the screen away.
          setPhase(PHASE.SUCCESS);
        },
        onError: (err) => {
          setPhase(PHASE.IDLE);
          setCode('');
          // The ticket is spent or expired, so asking again would fail the
          // same way. Back to the start, carrying the reason.
          if (err.restart) return restart(err.message);
          setMessage(err.message);
        },
      },
    );
  }

  return (
    <div
      className="min-h-screen relative flex flex-col items-center justify-center px-4 py-8 overflow-hidden"
      style={{ background: palette.void }}
    >
      <DianeEnvironment />

      {/* ---- Diane ------------------------------------------------------ */}
      <div
        className={`relative shrink-0 transition-all duration-1000 ease-out ${
          ready ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
        style={{
          width: 'clamp(220px, 34vh, 360px)',
          height: 'clamp(220px, 34vh, 360px)',
          // Success expands her briefly before the page turns over.
          transform: phase === PHASE.SUCCESS ? 'scale(1.06)' : undefined,
        }}
      >
        <Suspense fallback={<OrbFallback />}>
          <LoginOrb phase={phase} />
        </Suspense>
      </div>

      {/* Just the light she casts downward — no ring outlines.
          There WERE three concentric ellipses here reading as a plinth, and
          they cut straight across her lower particles: hard 1px lines
          drawn over a soft glowing sphere, so instead of the orb sitting
          above a surface it looked like something was crossing her out.
          A soft pool of light does the same job (she's above something,
          she's a light source) without a single edge to collide with. */}
      <div
        className={`relative -mt-10 mb-1 w-full max-w-md h-14 transition-opacity duration-1000 ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden="true"
      >
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-0 w-72 h-14"
          style={{
            background:
              `radial-gradient(ellipse 50% 100% at 50% 100%, ${tint(0.3)} 0%, ${tint(0.1)} 45%, transparent 75%)`,
          }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-0 w-40 h-6 blur-lg"
          style={{
            background:
              `radial-gradient(ellipse 50% 100% at 50% 100%, ${tint(0.55, palette.hot)} 0%, transparent 70%)`,
          }}
        />
      </div>

      {/* ---- the card --------------------------------------------------- */}
      <div
        className={`relative w-full max-w-md transition-all ease-out ${
          ready ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        } ${phase === PHASE.SUCCESS ? 'opacity-0 scale-95' : ''}`}
        // On the way out this has to finish inside the window useLogin
        // holds open, so it takes its duration from that same constant.
        style={{ transitionDuration: phase === PHASE.SUCCESS ? `${LOGIN_TRANSITION_MS}ms` : '700ms' }}
      >
        <HoloFrame />

        <form onSubmit={handleSubmit} className="relative px-8 py-9 sm:px-10" autoComplete="on">
          {/* Heading and fields fade together, so the two steps read as one
              card changing rather than two screens. The button below stays
              put and only relabels, which keeps the card from jumping. */}
          <div
            className={`transition-all ease-out ${
              swapping ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
            }`}
            style={{ transitionDuration: `${SWAP_MS}ms` }}
          >
          <h1
            className="text-center text-2xl font-bold text-diane-signal"
            style={{ textShadow: `0 0 24px ${tint(0.45)}` }}
          >
            {step === STEP.CODE ? 'One more step' : 'Welcome back'}
          </h1>
          <p className="text-center text-sm text-white/45 mt-1.5 mb-7">
            {step === STEP.CODE
              ? 'Enter your secret code to continue'
              : 'Sign in to continue to your workspace'}
          </p>

          {step === STEP.CODE ? (
            <>
              <label htmlFor="secret-code" className="block text-sm text-white/75 mb-2">
                Secret code
              </label>
              <div className="relative mb-6">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-diane-signal/70">
                  <KeyIcon />
                </span>
                <input
                  id="secret-code"
                  name="secret-code"
                  type={showCode ? 'text' : 'password'}
                  // Never offered to a password manager as the password,
                  // and never filled from one: it is the half that is
                  // meant not to live in the same place.
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="Enter your secret code"
                  className="diane-input w-full rounded-lg border pl-12 pr-12 py-3 text-white text-[0.95rem] placeholder:text-white/25 focus:outline-none transition-colors"
                  style={{ background: palette.sunken, borderColor: tint(0.28) }}
                  onFocus={(e) => { e.target.style.borderColor = tint(0.75); }}
                  onBlur={(e) => { e.target.style.borderColor = tint(0.28); }}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 min-h-0 p-1.5 border-0 bg-transparent text-white/35 hover:text-diane-signal transition-colors"
                  onClick={() => setShowCode((v) => !v)}
                  aria-label={showCode ? 'Hide code' : 'Show code'}
                  aria-pressed={showCode}
                  tabIndex={-1}
                >
                  {showCode ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </>
          ) : (
            <>
          <label htmlFor="username" className="block text-sm text-white/75 mb-2">
            Username
          </label>
          <div className="relative mb-5">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-diane-signal/70">
              <UserIcon width={18} height={18} />
            </span>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="Enter your username"
              className="diane-input w-full rounded-lg border pl-12 pr-4 py-3 text-white text-[0.95rem] placeholder:text-white/25 focus:outline-none transition-colors"
              style={{ background: palette.sunken, borderColor: tint(0.28) }}
              onFocus={(e) => { e.target.style.borderColor = tint(0.75); }}
              onBlur={(e) => { e.target.style.borderColor = tint(0.28); }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>

          <label htmlFor="password" className="block text-sm text-white/75 mb-2">
            Password
          </label>
          {/* mb-4 when the Remember box follows it, mb-6 when nothing does:
              the gap before the button is otherwise the field's own
              spacing, which reads as cramped. */}
          <div className={`relative ${SHOW_REMEMBER ? 'mb-4' : 'mb-6'}`}>
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-diane-signal/70">
              <LockIcon width={18} height={18} />
            </span>
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              className="diane-input w-full rounded-lg border pl-12 pr-12 py-3 text-white text-[0.95rem] placeholder:text-white/25 focus:outline-none transition-colors"
              style={{ background: palette.sunken, borderColor: tint(0.28) }}
              onFocus={(e) => { e.target.style.borderColor = tint(0.75); }}
              onBlur={(e) => { e.target.style.borderColor = tint(0.28); }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 min-h-0 p-1.5 border-0 bg-transparent text-white/35 hover:text-diane-signal transition-colors"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          {/* No "forgot password" — user's own call, and honest: there's no
              reset flow behind it. One shared admin credential lives in
              `tb_accounts` and is changed with the seed-admin script. */}
          {SHOW_REMEMBER && (
          <label className="flex items-center gap-2.5 mb-6 cursor-pointer select-none w-fit">
            <span
              className="w-[18px] h-[18px] rounded border flex items-center justify-center transition-all shrink-0"
              style={{
                borderColor: tint(remember ? 0.9 : 0.35),
                background: remember ? tint(0.9) : 'transparent',
              }}
            >
              {remember && (
                <CheckIcon width={11} height={11} strokeWidth={3.5} style={{ color: palette.void }} />
              )}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span className="text-sm text-white/60">Remember me</span>
          </label>
          )}
            </>
          )}
          </div>

          <button
            type="submit"
            disabled={busy || phase !== PHASE.IDLE || swapping}
            className="w-full rounded-lg border-0 py-3.5 font-bold text-diane-void text-[0.95rem] flex items-center justify-center gap-2 transition-all disabled:opacity-70"
            style={{
              background: `linear-gradient(180deg, ${palette.hot} 0%, ${palette.signal} 100%)`,
              boxShadow: `0 0 28px ${tint(0.35)}`,
            }}
          >
            {submitLabel(step, phase)}
            {phase === PHASE.IDLE && <ArrowIcon />}
          </button>

          {step === STEP.CODE && phase !== PHASE.SUCCESS && (
            <button
              type="button"
              className="mx-auto mt-3 block min-h-0 border-0 bg-transparent px-2 py-1 text-sm text-white/40 hover:text-diane-signal transition-colors"
              onClick={() => restart()}
              disabled={busy}
            >
              Back
            </button>
          )}

          {message && (
            <p className="mt-4 text-sm text-center text-diane-alert" role="alert">
              {message}
            </p>
          )}

          <div className="flex items-center gap-4 my-6" aria-hidden="true">
            <span className="flex-1 h-px" style={{ background: tint(0.18) }} />
            <span className="text-xs text-white/30">OR</span>
            <span className="flex-1 h-px" style={{ background: tint(0.18) }} />
          </div>

          <p className="flex items-center justify-center gap-2 text-sm text-white/45">
            <span className="text-diane-signal"><ShieldIcon /></span>
            Trusted <span className="text-white/20">•</span> Private <span className="text-white/20">•</span> Secure
          </p>
        </form>
      </div>
    </div>
  );
}

function submitLabel(step, phase) {
  if (phase === PHASE.SUCCESS) return 'Welcome back';
  if (step === STEP.CODE) return phase === PHASE.AUTHENTICATING ? 'Checking…' : 'Verify';
  return phase === PHASE.AUTHENTICATING ? 'Signing in…' : 'Sign in';
}

// Shown while the orb's chunk loads, and on a machine with no WebGL at
// all — the login stays fully usable either way, which matters more than
// the orb being present.
function OrbFallback() {
  // The chosen theme's palette. See configs/themes.js.
  const palette = useDianePalette();
  const { tint } = palette;
  return (
    <div className="w-full h-full flex items-center justify-center" aria-hidden="true">
      <div
        className="w-2/3 h-2/3 rounded-full animate-pulse"
        style={{
          background:
            `radial-gradient(circle, ${tint(0.5)} 0%, ${tint(0.12)} 55%, transparent 72%)`,
        }}
      />
    </div>
  );
}
