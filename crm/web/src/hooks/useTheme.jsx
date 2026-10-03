import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import { themeOf } from '../configs/themes';
import { applyTheme, readThemeId, saveThemeId } from '../helpers/theme';

// The active theme for code that needs a colour's VALUE (canvas, SVG, WebGL).
// Everything else reads the CSS variables and needs none of this.
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(readThemeId);
  const setTheme = useCallback((id) => {
    applyTheme(id);
    saveThemeId(id);
    setThemeId(id);
  }, []);
  const value = useMemo(() => ({ themeId, theme: themeOf(themeId), setTheme }), [themeId, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** { themeId, theme, setTheme }. Outside a provider, the saved theme, read only. */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  const themeId = readThemeId();
  return { themeId, theme: themeOf(themeId), setTheme: () => {} };
}
