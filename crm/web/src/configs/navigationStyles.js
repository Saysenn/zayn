// ***************************************************
// * The one active state, sidebar and settings alike
// ***************************************************
//
// ACTIVE AND HOVER MUST NOT LOOK THE SAME. Both were once a pale tinted
// rectangle, so the page you are ON and the page your cursor is OVER read
// as the same weight. They are separated by HUE now, not by weight: active
// is the green tint with green ink, hover is a plain grey wash and never
// coloured. User's own call, matching the reference design.
export const ACTIVE_NAV_CLASS =
  'bg-accent-tint text-accent-strong font-semibold [&_svg]:text-accent-strong';

export const INACTIVE_NAV_CLASS =
  'text-text-muted hover:bg-surface-sunken hover:text-text';
