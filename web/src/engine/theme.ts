import { PALETTE, type ColorName, type Deco } from '../../../shared/model.ts';
import { isLight, mix, type Palette } from '../../../shared/themes.ts';

// The board's color theme. Canvas sets it before its children render; views re-render via the `pv` prop.
let palette: Palette = PALETTE as unknown as Palette;
export const setPalette = (p: Palette) => { palette = p; };
export const activePalette = () => palette;

export type Theme = 'light' | 'dark';

export const CANVAS = {
  light: { bg: '#FFFFFF', dot: '#D5DCE3', text: '#1F2A35', muted: '#798897', select: '#2987D7', plate: '#FFFFFF' },
  dark: { bg: '#12161B', dot: '#2A313A', text: '#E8ECEF', muted: '#9FADBA', select: '#4DA3EE', plate: '#12161B' },
};

export { mix };

export type Paint = { fill: string; stroke: string; text: string; dash: boolean };

// Shapes follow Whimsical: fill = solid base color, outline = tinted fill with colored border.
export function shapePaint(color: ColorName, deco: Deco, theme: Theme): Paint {
  const c = palette[color], t = CANVAS[theme];
  if (deco === 'fill') return { fill: c.base, stroke: c.base, text: isLight(c.base) ? '#1F2A35' : '#FFFFFF', dash: false };
  if (deco === 'transparent') return { fill: 'transparent', stroke: 'transparent', text: t.text, dash: false };
  const neutral = color === 'white' || color === 'light-gray';
  const fill = theme === 'light' ? c.fill : neutral ? '#181D23' : mix(t.bg, c.base, 0.2);
  const stroke = theme === 'dark' && neutral ? '#4D5D6C' : c.stroke;
  return { fill, stroke, text: t.text, dash: deco === 'dash' };
}

export function stickyPaint(color: ColorName, theme: Theme) {
  const base = palette[color].base;
  return theme === 'light'
    ? { fill: mix(base, '#FFFFFF', 0.55), text: '#1F2A35' }
    : { fill: mix(base, CANVAS.dark.bg, 0.5), text: '#FFFFFF' };
}

export const inkColor = (color: ColorName, theme: Theme) =>
  color === 'default' || color === 'white' ? CANVAS[theme].text : theme === 'dark' && color === 'dark-purple' ? '#B37BE6' : palette[color].base;

export const lineColor = (color: ColorName, theme: Theme) =>
  color === 'silver' ? (theme === 'dark' ? '#798897' : '#9FADBA') : inkColor(color, theme);

export function sectionPaint(color: ColorName, deco: 'fill' | 'outline', theme: Theme) {
  const c = palette[color], t = CANVAS[theme];
  const tint = theme === 'light' ? mix('#FFFFFF', c.base, 0.12) : mix(t.bg, c.base, 0.12);
  return { fill: deco === 'fill' ? tint : 'transparent', stroke: theme === 'dark' && color === 'light-gray' ? '#3A434D' : c.stroke, title: t.muted };
}

// Presence colors for other people's cursors.
export const PEER_COLORS = ['#2987D7', '#D5475B', '#26AEA0', '#BE36D3', '#E8843C', '#665BF3', '#007A6F', '#A46767'];
