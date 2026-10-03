// ***************************************************
// * THE THEMES. Every colour that changes with the Appearance setting.
// ***************************************************
//
// His call 2026-09-27: five light accents, chosen in Settings, and the whole
// system follows: the CRM, the login and its orb, and Diane's screens.
//
// ONE PLACE. Each theme names every value it changes; nothing is derived at
// runtime from another colour, so what is written here is what is shown.
// Everything reads it as CSS variables (tailwind.config.js, the `accent-*`,
// neutral and `diane-*` classes) or through useTheme() where a canvas, an
// SVG or WebGL needs the value itself.
//
// WHAT DOES NOT CHANGE, on purpose: status colours (paying, ended, danger,
// warning, the payment start tints) keep their meaning, and the export files,
// print page and PDFs keep their own palettes.
//
// THE ROLES, as tailwind.config.js documents them: `accent` is a pale fill
// that takes `ink`, `strong` is text on white AND the solid button fill that
// takes white text. themes.test.js holds every theme to those contrasts.

// Teal, his call 2026-09-28. Green stays as a choice.
export const DEFAULT_THEME_ID = 'teal';

export const THEMES = Object.freeze({
  green: {
    label: 'Green',
    accent: {
      DEFAULT: '#8ce3b1', deep: '#64cf94', strong: '#14764a', 'strong-deep': '#0f5c39',
      ink: '#083321', tint: '#eefaf3', 'tint-strong': '#d8f3e4',
    },
    neutral: {
      bg: '#f7f9f8', 'surface-sunken': '#f3f6f4', border: '#e7ede9', 'border-strong': '#d3ded8',
      text: '#243029', 'text-muted': '#5b6b62', 'text-faint': '#8a988f', shadow: '#122d1f',
    },
    chart: { area: '#54d7a1', track: '#e9f5ef' },
    diane: {
      void: '#02100a', panel: '#07180f', sunken: '#041209', line: '#2f7d59',
      signal: '#7af0aa', hot: '#d8ffe9', dim: '#49a97a', accent: '#34d399', warn: '#ffb84d',
    },
  },
  teal: {
    label: 'Teal',
    accent: {
      DEFAULT: '#99e6dc', deep: '#6fd6c9', strong: '#0f766e', 'strong-deep': '#115e59',
      ink: '#083b37', tint: '#effbf9', 'tint-strong': '#d2f4ef',
    },
    neutral: {
      bg: '#f6f9f9', 'surface-sunken': '#f1f6f6', border: '#e3ecec', 'border-strong': '#cfdddc',
      text: '#1f2d2c', 'text-muted': '#566867', 'text-faint': '#869897', shadow: '#0c2b29',
    },
    chart: { area: '#6fd6c9', track: '#e6f6f4' },
    diane: {
      void: '#021110', panel: '#071a19', sunken: '#041413', line: '#2b7f78',
      signal: '#7ff0e2', hot: '#e0fffb', dim: '#56b0a6', accent: '#2dd4bf', warn: '#ffb84d',
    },
  },
  // His call: yellow's partner is MAROON (was black, before that brown).
  yellow: {
    label: 'Yellow',
    accent: {
      DEFAULT: '#ffe07a', deep: '#ffd24a', strong: '#7a1f2b', 'strong-deep': '#5c1620',
      ink: '#5c1620', tint: '#fffbea', 'tint-strong': '#fff3c4',
    },
    neutral: {
      bg: '#fafaf7', 'surface-sunken': '#f4f4f0', border: '#e8e8e2', 'border-strong': '#d4d4cc',
      text: '#1c1c1c', 'text-muted': '#5e5e5e', 'text-faint': '#8e8e8e', shadow: '#111111',
    },
    chart: { area: '#ffd24a', track: '#fff8dc' },
    diane: {
      void: '#0b0b0b', panel: '#161616', sunken: '#111111', line: '#5a5a5a',
      signal: '#ffd84d', hot: '#fff7d6', dim: '#b8b8b8', accent: '#ffac1c', warn: '#ff7a45',
    },
  },
  // THE EXPORT'S "Blue white", which he likes: Excel's Blue, Accent 1. The
  // tint and its strong step are the export's own #F2F8FD and #DDEBF7.
  blue: {
    label: 'Light blue',
    accent: {
      DEFAULT: '#bcd8f2', deep: '#9dc3e6', strong: '#2e6ca8', 'strong-deep': '#245687',
      ink: '#0f2c4a', tint: '#f2f8fd', 'tint-strong': '#ddebf7',
    },
    neutral: {
      bg: '#f6f8fb', 'surface-sunken': '#f1f5f9', border: '#e3e9f0', 'border-strong': '#cfd9e4',
      text: '#1f2a36', 'text-muted': '#56657a', 'text-faint': '#8595a8', shadow: '#0f233c',
    },
    chart: { area: '#9dc3e6', track: '#eaf2fa' },
    diane: {
      void: '#06111f', panel: '#0c1d33', sunken: '#09172a', line: '#3f7fbf',
      signal: '#9fd0ff', hot: '#eef7ff', dim: '#8fb4d9', accent: '#5aa9f5', warn: '#ffb84d',
    },
  },
  // His call: red, partnered with a SUBTLE yellow (the pale fills and tints).
  // Diane's ground is CHARCOAL, not dark red: a red one read as bloody.
  red: {
    label: 'Red',
    accent: {
      DEFAULT: '#ffe9a8', deep: '#ffdb7a', strong: '#b91c1c', 'strong-deep': '#991b1b',
      ink: '#7f1d1d', tint: '#fff9e6', 'tint-strong': '#fdeec2',
    },
    neutral: {
      bg: '#faf8f6', 'surface-sunken': '#f6f2ef', border: '#eee6e2', 'border-strong': '#ddd1cb',
      text: '#2d2322', 'text-muted': '#695a57', 'text-faint': '#998985', shadow: '#2d1010',
    },
    chart: { area: '#f87171', track: '#fdf1e0' },
    diane: {
      void: '#0e0e10', panel: '#18181b', sunken: '#131316', line: '#5a5a60',
      signal: '#ff8a80', hot: '#fff4d6', dim: '#b5b5bb', accent: '#ffd166', warn: '#ffb84d',
    },
  },
});

export const THEME_IDS = Object.freeze(Object.keys(THEMES));

// Diane's words and her one red are the same in every theme.
const DIANE_FIXED = Object.freeze({
  speech: '#ffffff',
  settled: 'rgba(255, 255, 255, 0.45)',
  alert: '#ff7a6b',
});

export const themeOf = (id) => THEMES[id] ?? THEMES[DEFAULT_THEME_ID];

/** Diane's full palette in a theme: its own colours plus the fixed ones. */
export function dianeOf(theme) {
  return { ...theme.diane, ...DIANE_FIXED };
}

// ===============================
// * AS CSS VARIABLES
// ===============================
// "r g b", so Tailwind's /35 alpha classes keep working. Anything that is
// not a hex (an rgba) is left out: it is used as written.
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v) => HEX.test(String(v));
export function triplet(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const varsFrom = (prefix, palette) => Object.fromEntries(Object.entries(palette)
  .filter(([, v]) => isHex(v))
  .map(([k, v]) => [k === 'DEFAULT' ? `--${prefix}` : `--${prefix}-${k}`, triplet(v)]));

/** Every variable one theme sets, for :root. */
export function themeVars(theme) {
  return {
    ...varsFrom('accent', theme.accent),
    ...varsFrom('n', theme.neutral),
    ...varsFrom('diane', dianeOf(theme)),
  };
}

/** The Tailwind colour for a variable. */
export const fromVar = (name) => `rgb(var(--${name}) / <alpha-value>)`;
