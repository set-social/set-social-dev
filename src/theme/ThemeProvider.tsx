import React, { createContext, useContext, useMemo } from 'react';
import {
  darkColors,
  lightColors,
  spacing,
  radii,
  shadows,
  darkGradients,
  lightGradients,
  sizes,
  typography,
  fontFamily,
} from './tokens';
import { useThemePreferenceStore } from '../store/themePreferenceStore';
import type { ColorScheme } from '../store/themePreferenceStore';

const darkTheme = {
  colorScheme: 'dark' as ColorScheme,
  colors: darkColors,
  spacing,
  radii,
  shadows,
  gradients: darkGradients,
  sizes,
  typography,
  fontFamily,
} as const;

const lightTheme = {
  colorScheme: 'light' as ColorScheme,
  colors: lightColors,
  spacing,
  radii,
  shadows,
  gradients: lightGradients,
  sizes,
  typography,
  fontFamily,
} as const;

export type Theme = typeof darkTheme;

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useThemePreferenceStore(state => state.colorScheme);
  const value = useMemo(
    () => (colorScheme === 'light' ? lightTheme : darkTheme),
    [colorScheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
