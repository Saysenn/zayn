// ***************************************************
// * DIANE'S PALETTE, in whichever theme is chosen
// ***************************************************
//
// She was green in 177 hardcoded literals across 19 files, so a colour
// change was 19 edits and a guarantee that two of them would drift. Every
// colour of hers now comes from configs/themes.js, where each theme names
// her palette, and this file shapes it for the screens that need more than
// the palette itself.
//
// Two consumers, both reading the theme:
//   tailwind.config.js  ->  the `diane-*` classes, through CSS variables
//   the components      ->  useDianePalette(), for THREE.Color, canvas
//                           fills and inline styles
//
// THE NAMES SAY THE ROLE, NEVER THE HUE. `signal`, `hot`, `dim`: a palette
// with `green` or `gold` in its keys has to be renamed every time somebody
// changes their mind, which is how two names end up in circulation.

import { THEMES, DEFAULT_THEME_ID, dianeOf } from './themes.js';

// The default theme's palette, for anything read before a theme is known.
export const DIANE = dianeOf(THEMES[DEFAULT_THEME_ID]);

/** The command center: her palette, a faint glow in its two colours, no scanlines. */
export const commandCenterOf = (diane) => ({
  ...diane,
  ambientFrom: diane.signal,
  ambientTo: diane.accent,
  scanlines: false,
});

/**
 * THE WELCOME PAGE'S HUD, his call 2026-09-28: "like JARVIS". Holographic cyan
 * on navy black, and FIXED: it does not follow the Appearance theme, the
 * command center does.
 */
export const JARVIS_HUD = Object.freeze({
  void: '#01070d',
  panel: '#041421',
  sunken: '#020d17',
  line: '#1b6f9e',
  signal: '#5fd4ff',
  hot: '#d6f6ff',
  dim: '#6fa8c8',
  accent: '#00a8ff',
  warn: '#ffb347',
  speech: '#e8fbff',
  settled: 'rgba(232, 251, 255, 0.55)',
  alert: '#ff6b5b',
});

/** The login orb's three phases. */
export const loginOrbColorsOf = (diane) => ({
  idle: diane.dim,
  authenticating: diane.signal,
  success: diane.hot,
});

/**
 * The boot orb's five modes. `glow` is additive blending on a dark ground;
 * `ink` is normal blending for a light one, where additive is invisible, so
 * it takes the CRM's dark accent steps. Both the same five keys, so a mode
 * can never exist in one and not the other.
 */
export const orbColorsOf = (theme) => {
  const diane = dianeOf(theme);
  return {
    glow: {
      idle: diane.dim, listening: diane.signal, thinking: diane.accent, speaking: diane.hot, building: diane.signal,
    },
    ink: {
      idle: theme.accent['strong-deep'],
      listening: theme.accent.strong,
      thinking: theme.accent['strong-deep'],
      speaking: theme.accent.strong,
      building: theme.accent.strong,
    },
  };
};

// The particles orb (agentOrb/particlesOrb): its own defaults, the playground
// values he asked for. The command center passes the theme's colours instead.
export const PARTICLES_ORB = {
  colorFrom: '#22d3ee',
  colorTo: '#34d399',
  errorFrom: '#fb7185',
  errorTo: '#f43f5e',
  size: 212,
  speed: 0.5,
};

// `rgba()` from one of her hexes. Used where a colour needs an alpha a
// Tailwind class cannot carry: a canvas fill, an SVG stroke, a gradient.
export function tint(alpha = 1, hex = DIANE.signal) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
