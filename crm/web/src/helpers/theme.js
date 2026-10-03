// ***************************************************
// * The chosen theme: read, applied to the page, remembered
// ***************************************************
// PER BROWSER, in localStorage: the login page has to be themed before
// anybody signs in, so it cannot wait on the server. Wrapped, because a
// private window or blocked storage throws, and the default theme then applies.

import { DEFAULT_THEME_ID, THEMES, themeOf, themeVars } from '../configs/themes.js';

const STORAGE_KEY = 'crm.theme';

export function readThemeId() {
  try {
    const id = window.localStorage.getItem(STORAGE_KEY);
    return THEMES[id] ? id : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not remembered in this browser; it still applies until reload.
  }
}

/** Sets every themed variable on the page's root. */
export function applyTheme(id) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVars(themeOf(id)))) root.style.setProperty(name, value);
  root.dataset.theme = THEMES[id] ? id : DEFAULT_THEME_ID;
}
