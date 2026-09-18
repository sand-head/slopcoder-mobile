/**
 * The web cockpit's design tokens, resolved for React Native.
 *
 * `src/SlopCoder.Web/wwwroot/app.css` is the source of truth — a shadcn preset
 * (style rhea, base mist, theme emerald, font geist) written in `oklch()`, with
 * `color-mix()` used ~40 times for tints. React Native has neither, so the
 * values below are that file converted to sRGB and the mixes precomputed by
 * {@link mix}. Light neutrals are cool mist; dark is warm charcoal at hue 72.
 *
 * Regenerate rather than hand-edit if app.css moves.
 */
import { useColorScheme } from 'react-native';

export interface Palette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarAccent: string;
  sidebarBorder: string;
}

const lightPalette: Palette = {
  background: '#ffffff',
  foreground: '#090b0c',
  card: '#ffffff',
  cardForeground: '#090b0c',
  popover: '#ffffff',
  popoverForeground: '#090b0c',
  primary: '#007a55',
  primaryForeground: '#ecfdf5',
  secondary: '#f4f4f5',
  secondaryForeground: '#18181b',
  muted: '#f1f3f3',
  mutedForeground: '#67787c',
  accent: '#f1f3f3',
  accentForeground: '#161b1d',
  destructive: '#e7000b',
  border: '#e3e7e8',
  input: '#e3e7e8',
  ring: '#9ca8ab',
  sidebar: '#f9fbfb',
  sidebarAccent: '#f1f3f3',
  sidebarBorder: '#e3e7e8',
};

const darkPalette: Palette = {
  background: '#181410',
  foreground: '#f1eee9',
  card: '#221d18',
  cardForeground: '#f1eee9',
  popover: '#221d18',
  popoverForeground: '#f1eee9',
  primary: '#009966',
  primaryForeground: '#ecfdf5',
  secondary: '#2f2b25',
  secondaryForeground: '#f1eee9',
  muted: '#2d2823',
  mutedForeground: '#a59d92',
  accent: '#2d2823',
  accentForeground: '#f1eee9',
  destructive: '#ff6467',
  border: 'rgba(255, 255, 255, 0.1)',
  input: 'rgba(255, 255, 255, 0.12)',
  ring: '#a69d91',
  sidebar: '#0f0c08',
  sidebarAccent: '#231e19',
  sidebarBorder: 'rgba(255, 255, 255, 0.1)',
};

/**
 * Status colours. Amber = running, emerald = ok, violet = thinking,
 * fuchsia = subagent, sky = plan — the mapping the transcript uses.
 */
export const accent = {
  colorAmber300: '#ffd230',
  colorAmber400: '#ffb900',
  colorAmber500: '#fe9a00',
  colorAmber600: '#e17100',
  colorEmerald50: '#ecfdf5',
  colorEmerald300: '#5ee9b5',
  colorEmerald400: '#00d492',
  colorEmerald500: '#00bc7d',
  colorEmerald600: '#009966',
  colorEmerald700: '#007a55',
  colorSky400: '#00bcff',
  colorSky600: '#0084d1',
  colorViolet400: '#a684ff',
  colorViolet500: '#8e51ff',
  colorFuchsia400: '#ed6aff',
  colorFuchsia600: '#c800de',
  colorZinc500: '#71717b',
  colorZinc900: '#18181b',
} as const;

/**
 * Sub-session tints: one shade per partner, so Ada is the same colour on her
 * card, on her replies, and everywhere the agent names her in prose. The server
 * allocates these round-robin per parent (`SubSessionPalette`), never hashed
 * and never random, so no two partners on a team collide. Emerald and amber are
 * absent on purpose — they already mean ok and running here.
 *
 * Mirrors slopcoder's `--tint-*` tokens in app.css: the same hues, the same two
 * lightness levels, written as hex because there is no oklch() in React Native.
 */
const tints = {
  violet: { light: '#7645d8', dark: '#b39bff' },
  amber: { light: '#8a6410', dark: '#e8c168' },
  sky: { light: '#0e6f9e', dark: '#7cc6ec' },
  rose: { light: '#c03259', dark: '#f79aae' },
  teal: { light: '#0e6d70', dark: '#69c8c6' },
  fuchsia: { light: '#a33396', dark: '#ec9ae0' },
  indigo: { light: '#4a51c9', dark: '#9ba5f2' },
  orange: { light: '#9c5117', dark: '#eaa377' },
} as const;

/**
 * A partner's colour by name, or null when there is none to apply — a
 * sub-session from before tints, or a name this build has never heard of. Null
 * rather than a fallback shade: an untinted partner reads as untinted, where a
 * wrong-but-present colour reads as a different partner.
 */
export function tintFor(
  name: string | null | undefined,
  dark: boolean,
): string | null {
  if (!name) return null;
  const tint = tints[name as keyof typeof tints];
  return tint ? (dark ? tint.dark : tint.light) : null;
}

/** Every tint name the server may send, for tests and pickers. */
export const tintNames = Object.keys(tints) as readonly (keyof typeof tints)[];

/** The lighter variant reads on the dark ground; the darker one on white. */
export function statusColors(dark: boolean) {
  return {
    running: dark ? accent.colorAmber400 : accent.colorAmber500,
    ok: dark ? accent.colorEmerald400 : accent.colorEmerald500,
    thinking: dark ? accent.colorViolet400 : accent.colorViolet500,
    subagent: dark ? accent.colorFuchsia400 : accent.colorFuchsia600,
    plan: dark ? accent.colorSky400 : accent.colorSky600,
  };
}

/** Stands in for `color-mix(in oklab, <color> N%, transparent)`. */
export function mix(color: string, percent: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${(percent / 100).toFixed(3)})`;
}

/** The shadcn scale off --radius: 0.625rem. */
export const radius = { sm: 6, md: 8, lg: 10, xl: 14, xxl: 18 } as const;

/**
 * Geist for names and prose, Geist Mono for everything else — meta lines,
 * labels, counts, timestamps, tool rows. That split is the strongest visual
 * signature of this UI, so it is a token rather than a per-screen choice.
 *
 * One family per weight, rather than one family and `fontWeight`. The upstream
 * files are variable fonts and React Native honours no weight axis, so these are
 * static cuts instanced at the two weights this app actually uses; each carries a
 * PostScript name equal to its filename, which is what lets a single string
 * resolve on both iOS and Android. Setting `fontWeight` alongside one of these
 * does nothing — pick the family instead.
 */
export const font = {
  sans: 'Geist-Regular',
  sansMedium: 'Geist-Medium',
  mono: 'GeistMono-Regular',
  monoSemiBold: 'GeistMono-SemiBold',
  display: 'Baloo2-ExtraBold',
} as const;

/** The mono-meta grammar: 11-12px, uppercase, generously tracked. */
export const meta = {
  fontFamily: font.mono,
  fontSize: 11,
  letterSpacing: 0.66,
  textTransform: 'uppercase',
} as const;

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return {
    isDark,
    c: isDark ? darkPalette : lightPalette,
    status: statusColors(isDark),
  };
}

export type Theme = ReturnType<typeof useTheme>;
