import type * as Y from 'yjs';
import { COLOR_NAMES, PALETTE, type ColorName } from './model.ts';

export type Swatch = { base: string; fill: string; stroke: string };
export type Palette = Record<ColorName, Swatch>;
export type BoardTheme = { name: string; base: Partial<Record<ColorName, string>> };

// "#RRGGBB" as [r, g, b]; a mix of two colors (t = 0 gives a, 1 gives b) as "#rrggbb".
export const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mix = (a: string, b: string, t: number) =>
  '#' + rgb(a).map((v, i) => Math.round(v * (1 - t) + rgb(b)[i] * t).toString(16).padStart(2, '0')).join('');
// Perceived brightness: dark text reads on a light fill, white text on the others.
export const isLight = (h: string) => { const [r, g, b] = rgb(h); return 0.299 * r + 0.587 * g + 0.114 * b > 170; };
const mixHex = (a: string, b: string, t: number) => mix(a, b, t).toUpperCase(); // stored themes keep upper case

// A theme only names base colors; the tinted fill and the stroke follow from the base, like Whimsical's palette.
export function paletteOf(theme: BoardTheme | null | undefined): Palette {
  if (!theme) return PALETTE as unknown as Palette;
  const out = { ...PALETTE } as unknown as Palette;
  for (const name of COLOR_NAMES) {
    const base = theme.base[name];
    if (base && /^#[0-9a-f]{6}$/i.test(base)) out[name] = { base: base.toUpperCase(), fill: mixHex(base, '#FFFFFF', 0.8), stroke: base.toUpperCase() };
  }
  return out;
}

const preset = (name: string, base: Partial<Record<ColorName, string>>): BoardTheme => ({ name, base });
export const PRESETS: BoardTheme[] = [
  preset('Whimsical', {}),
  preset('Pastel', { blue: '#7FB2E5', green: '#7FCFC2', yellow: '#F4D98B', orange: '#F2B184', red: '#E8949F', purple: '#D59BDF', 'whimsy-blue': '#9F98F4', 'dark-purple': '#A877D6', 'dark-green': '#5FA89F', brown: '#B7A98F', 'pale-red': '#C49A9A' }),
  preset('Bold', { blue: '#0B6FD1', green: '#00A38C', yellow: '#F5B800', orange: '#F36A10', red: '#E0233D', purple: '#B01CC9', 'whimsy-blue': '#4A3CF0', 'dark-purple': '#5C06A8', 'dark-green': '#006652', brown: '#7A5C2E', 'pale-red': '#A33C3C' }),
  preset('Ocean', { blue: '#1E6FA8', green: '#2A9D8F', yellow: '#E9C46A', orange: '#F4A261', red: '#E76F51', purple: '#6A4C93', 'whimsy-blue': '#3D5A80', 'dark-purple': '#293241', 'dark-green': '#1B4965', brown: '#8D6E63', 'pale-red': '#B5838D' }),
  preset('Sunset', { blue: '#5C6BC0', green: '#43A047', yellow: '#FFCA28', orange: '#FF7043', red: '#E53935', purple: '#AB47BC', 'whimsy-blue': '#7E57C2', 'dark-purple': '#6A1B9A', 'dark-green': '#2E7D32', brown: '#8D6E63', 'pale-red': '#D81B60' }),
  preset('Mono', { blue: '#4D5D6C', green: '#5E6E7D', yellow: '#9FADBA', orange: '#798897', red: '#3A4652', purple: '#66727F', 'whimsy-blue': '#2F3B47', 'dark-purple': '#1F2A35', 'dark-green': '#44515E', brown: '#8796A4', 'pale-red': '#56636F' }),
];

// Board-level settings (theme, timer, voting session) live in their own map of the board document.
export const settingsOf = (doc: Y.Doc) => doc.getMap<string>('settings');

// Voting: one entry per person (their votes by object id), so simultaneous votes never overwrite each other.
export const votesOf = (doc: Y.Doc) => doc.getMap<string>('votes');
export type VotingSession = { active: boolean; perPerson: number; by: string; byName: string; at: number };
export type TimerState = { endsAt: number | null; left: number | null; total: number; byName: string };
