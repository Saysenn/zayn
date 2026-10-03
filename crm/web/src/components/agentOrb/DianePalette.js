// ***************************************************
// * Which of Diane's palettes a component paints with
// ***************************************************
// The chosen theme's (configs/themes.js) by default, on every Diane screen.
// The command center provides its variant (commandCenterOf) around itself.

import { createContext, useContext, useMemo } from 'react';
import { dianeOf } from '../../configs/themes';
import { tint } from '../../configs/dianeTheme';
import { useTheme } from '../../hooks/useTheme';

const DianePaletteContext = createContext(null);

export const DianePaletteProvider = DianePaletteContext.Provider;

/** The palette in force, with `tint` defaulting to its own signal. */
export function useDianePalette() {
  const override = useContext(DianePaletteContext);
  const { theme } = useTheme();
  return useMemo(() => {
    const palette = override ?? dianeOf(theme);
    return { ...palette, tint: (alpha = 1, hex = palette.signal) => tint(alpha, hex) };
  }, [override, theme]);
}
