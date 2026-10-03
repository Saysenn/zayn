import {
  THEMES, DEFAULT_THEME_ID, dianeOf, themeVars, isHex, fromVar,
} from './src/configs/themes.js';
import { BADGE_CLASSES } from './src/configs/badgeKinds.js';

// ===============================
// * EVERY THEMED COLOUR IS A VARIABLE
// ===============================
// The Appearance setting swaps them on the page's root (configs/themes.js).
// :root holds the default theme, so a page is right before any script runs.
// Token names are the theme's own keys, so a new key needs no edit here.
const DEFAULT_THEME = THEMES[DEFAULT_THEME_ID];
const accentColors = Object.fromEntries(Object.keys(DEFAULT_THEME.accent)
  .map((k) => [k, fromVar(k === 'DEFAULT' ? 'accent' : `accent-${k}`)]));
const neutralColors = Object.fromEntries(Object.keys(DEFAULT_THEME.neutral)
  .filter((k) => k !== 'shadow')
  .map((k) => [k, fromVar(`n-${k}`)]));
const dianeColors = Object.fromEntries(Object.entries(dianeOf(DEFAULT_THEME))
  .map(([k, v]) => [k, isHex(v) ? fromVar(`diane-${k}`) : v]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  /**
   * ===============================
   * * CLASS NAMES NOTHING SPELLS OUT
   * ===============================
   * The scan above reads source TEXT, so a class built at runtime from a
   * value (`badge-${status}`) is never seen and its rule is dropped from
   * the build. Silently: the element still renders, just unstyled.
   *
   * One list, in configs/badgeKinds.js, so a new badge is styled by adding
   * it there rather than by remembering this file exists.
   */
  safelist: [...BADGE_CLASSES],
  theme: {
    /**
     * ===============================
     * * CORNERS ARE ROUNDED NOW
     * ===============================
     * This was `DEFAULT: 0` with a comment reading "flat, sharp,
     * deliberate", and every radius in the app was compiled away to
     * nothing. User's own call to reverse it.
     *
     * A SMALL SCALE, not Tailwind's full one. Four usable steps and a
     * pill: a control, a card, a panel, a dialog. More options is how two
     * cards side by side end up 6px and 8px for no reason anybody can
     * name.
     */
    borderRadius: {
      none: '0px',
      sm: '4px',      // a tag, a pip, a tick
      DEFAULT: '6px', // inputs and buttons
      md: '8px',
      lg: '10px',     // cards and panels
      xl: '14px',     // dialogs
      full: '9999px', // pills and true circles
    },
    extend: {
      colors: {
        // THEMED: the neutrals carry a faint tint of the accent. See themes.js.
        ...neutralColors,
        surface: '#ffffff',
        // ===============================
        // * THE ACCENT HAS SEVEN ROLES, and follows the theme
        // ===============================
        // A light theme cannot use one green for everything: the fill is
        // far too pale to put white text on, and far too pale to BE text
        // on white. So the role is in the key, and picking the wrong one
        // shows up as unreadable rather than merely off.
        //
        //   DEFAULT  a pale fill. Takes `ink` on top, never white.
        //   deep     the same pale fill, pressed or hovered. Still takes ink.
        //   strong   text, icons and borders ON WHITE, AND the solid fill a
        //            primary button wears. It clears 4.5:1 against the page
        //            and under white type, in every theme (themes.test.js).
        //   strong-deep  that solid fill, pressed or hovered.
        //   ink      text that sits ON the pale fill.
        // THEMED: the seven roles above, per theme in configs/themes.js.
        accent: accentColors,
        'metric-blue': { DEFAULT: '#edf5ff', ink: '#2563a6' },
        'metric-violet': { DEFAULT: '#f4efff', ink: '#6d4bb5' },
        'metric-peach': { DEFAULT: '#fff1e7', ink: '#a95323' },
        danger: { DEFAULT: '#b3261e', tint: '#fbeae9' },
        // `strong` follows the accent's own naming: the step meant for
        // ICONS AND TEXT ON WHITE. DEFAULT doubles as a solid button fill,
        // so it cannot be darkened without dragging the button with it.
        //
        // GOLD, AND IT STAYS GOLD. This was #8a4a05 for one build, which is
        // brown-orange: it read as a weak danger rather than as a warning,
        // and warning and danger are the two that must never be confused.
        // Same hue family as DEFAULT, fully saturated, 4.9:1 on the page.
        warning: { DEFAULT: '#92660a', strong: '#8f6c00', tint: '#fbf1dc' },
        // SUCCESS, FIXED GREEN. Paying, active and confirmed were drawn in
        // the accent; in an orange or yellow theme they would read as a
        // warning. The green they always were, whatever the theme.
        success: { strong: '#14764a', tint: '#eefaf3' },
        // Diane's own world: the command center, the login and the boot
        // screen. Not the CRM's palette and never mixed with it. Themed with
        // it, in configs/themes.js, which her canvas code reads too.
        diane: dianeColors,
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          'Helvetica', 'Arial', 'sans-serif',
        ],
      },
      /**
       * ===============================
       * * THE SCALE ITSELF IS FLUID
       * ===============================
       *
       * ONE DEFINITION, NOT A `sm:` VARIANT ON EVERY HEADING. The app sets
       * an explicit size on nearly every element (271 of them), so a
       * smaller body size alone changed almost nothing: each `text-sm`
       * overrode it. Adding a breakpoint variant to each was 271 edits and
       * 271 chances to miss one.
       *
       * Each step ramps from its phone size at 375px to its design size at
       * 640px, the `sm` breakpoint, and clamps flat outside that range.
       * Nothing between those two numbers has to be decided again.
       *
       * TYPE ONLY. Spacing stays put: shrinking the root font size would
       * have taken every padding, gap and sidebar width with it, and a
       * cramped phone layout is not the same request as smaller text.
       *
       * The line heights are the tuples Tailwind's own scale carries. A
       * bare string drops them, which is what left the larger headings
       * running into each other.
       */
      fontSize: {
        xs: ['clamp(0.6875rem, 0.599rem + 0.377vw, 0.75rem)', '1rem'],
        sm: ['clamp(0.75rem, 0.662rem + 0.377vw, 0.8125rem)', '1.25rem'],
        base: ['clamp(0.844rem, 0.711rem + 0.566vw, 0.9375rem)', '1.5rem'],
        lg: ['clamp(0.9375rem, 0.761rem + 0.755vw, 1.0625rem)', '1.75rem'],
        xl: ['clamp(1.125rem, 0.771rem + 1.509vw, 1.375rem)', '1.75rem'],
        '2xl': ['clamp(1.25rem, 0.896rem + 1.509vw, 1.5rem)', '2rem'],
        '3xl': ['clamp(1.5rem, 0.969rem + 2.264vw, 1.875rem)', '2.25rem'],
      },
      spacing: {
        sidebar: '15.5rem',
        bottomnav: '3.5rem',
        // The phone's home bar. 0 where there is none; needs viewport-fit=cover.
        safebottom: 'env(safe-area-inset-bottom, 0px)',
        header: '3.25rem',
      },
    },
  },
  plugins: [
    ({ addBase }) => addBase({ ':root': themeVars(DEFAULT_THEME) }),
  ],
};
