/**
 * Semantic colors, mirrored from the CSS tokens in `src/global.css`. Prefer
 * Tailwind `className` (e.g. `bg-primary`, `text-foreground`) in components;
 * this map is only for the native props that can't take a className — glass
 * `tintColor`, `Icon` `color`, `ActivityIndicator`, `NativeTabs`,
 * `TextInput` placeholder/selection, etc. Keep both in sync.
 */

import { Platform } from "react-native";

export const Colors = {
  light: {
    background: "#ffffff",
    sheet: "#ffffff",
    foreground: "#000000",
    card: "#f7f7f5",
    cardForeground: "#000000",
    primary: "#000000",
    primaryForeground: "#ffffff",
    secondary: "#f7f7f5",
    secondaryForeground: "#000000",
    muted: "#00000014",
    mutedForeground: "#8e8e93",
    destructive: "#ff3b30",
    destructiveForeground: "#ffffff",
    border: "#0000000d",
    input: "#f7f7f5",
    ring: "#000000",
  },
  dark: {
    background: "#000000",
    sheet: "#111113",
    foreground: "#ffffff",
    card: "#ffffff14",
    cardForeground: "#ffffff",
    primary: "#ffffff",
    primaryForeground: "#000000",
    secondary: "#111113",
    secondaryForeground: "#ffffff",
    muted: "#ffffff14",
    mutedForeground: "#8e8e93",
    destructive: "#ff453a",
    destructiveForeground: "#ffffff",
    border: "#ffffff14",
    input: "#111113",
    ring: "#ffffff",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
