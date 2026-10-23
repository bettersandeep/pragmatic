import type { ShapeKind } from '../../../shared/model.ts';
import type { Paint } from './theme.ts';

const SW = 2; // stroke width in world px

// Unit-space paths for organic shapes, scaled with a non-scaling stroke.
const CLOUD = 'M25 60 C10 60 2 50 6 40 C0 30 8 18 20 20 C22 8 38 2 48 10 C56 0 74 2 78 14 C92 12 100 26 94 36 C102 46 94 60 80 58 C74 66 58 66 52 60 C46 66 32 66 25 60 Z';
const STAR = 'M50 2 L61.8 36.2 L97.6 36.2 L68.6 57.4 L79.4 92 L50 71 L20.6 92 L31.4 57.4 L2.4 36.2 L38.2 36.2 Z';

export function ShapeSvg({ kind, w, h, paint }: { kind: ShapeKind; w: number; h: number; paint: Paint }) {
  const i = SW / 2, W = w - SW, H = h - SW;
  const common = { fill: paint.fill, stroke: paint.stroke, strokeWidth: SW, strokeDasharray: paint.dash ? '8 6' : undefined, strokeLinejoin: 'round' as const };
  const poly = (pts: number[][]) => <polygon points={pts.map(([x, y]) => `${x + i},${y + i}`).join(' ')} {...common} />;
  const s = Math.min(W * 0.18, H * 0.6);
  let body;
  switch (kind) {
    case 'rect': case 'code': case 'actor': body = <rect x={i} y={i} width={W} height={H} rx={4} {...common} />; break;
    case 'pill': body = <rect x={i} y={i} width={W} height={H} rx={Math.min(W, H) / 2} {...common} />; break;
    case 'oval': body = <ellipse cx={w / 2} cy={h / 2} rx={W / 2} ry={H / 2} {...common} />; break;
    case 'diamond': body = poly([[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]); break;
    case 'parallelogram': body = poly([[s, 0], [W, 0], [W - s, H], [0, H]]); break;
    case 'parallelogram-flip': body = poly([[0, 0], [W - s, 0], [W, H], [s, H]]); break;
    case 'trapezoid': body = poly([[s, 0], [W - s, 0], [W, H], [0, H]]); break;
    case 'triangle': body = poly([[W / 2, 0], [W, H], [0, H]]); break;
    case 'hexagon': { const k = Math.min(W * 0.2, H * 0.5); body = poly([[k, 0], [W - k, 0], [W, H / 2], [W - k, H], [k, H], [0, H / 2]]); break; }
    case 'cylinder': {
      const ry = Math.min(H * 0.12, 14);
      body = <>
        <path d={`M${i},${i + ry} A${W / 2},${ry} 0 0 1 ${i + W},${i + ry} V${i + H - ry} A${W / 2},${ry} 0 0 1 ${i},${i + H - ry} Z`} {...common} />
        <path d={`M${i},${i + ry} A${W / 2},${ry} 0 0 0 ${i + W},${i + ry}`} {...common} fill="none" />
      </>;
      break;
    }
    case 'annotation': {
      // The tail scales down with the width, so small shapes and picker icons keep it inside the box.
      const t = Math.min(16, H * 0.25), b = H - t, r = Math.min(4, W / 6, b / 3), k = Math.min(1, W / 90);
      body = <path d={`M${i + r},${i} H${i + W - r} Q${i + W},${i} ${i + W},${i + r} V${i + b - r} Q${i + W},${i + b} ${i + W - r},${i + b} H${i + 36 * k} L${i + 18 * k},${i + H} L${i + 22 * k},${i + b} H${i + r} Q${i},${i + b} ${i},${i + b - r} V${i + r} Q${i},${i} ${i + r},${i} Z`} {...common} />;
      break;
    }
    case 'line': body = <line x1={i} y1={h / 2} x2={i + W} y2={h / 2} {...common} stroke={paint.stroke === 'transparent' ? paint.text : paint.stroke} />; break;
    case 'cross': body = <path d={`M${i},${i} L${i + W},${i + H} M${i + W},${i} L${i},${i + H}`} {...common} fill="none" stroke={paint.stroke === 'transparent' ? paint.text : paint.stroke} />; break;
    case 'bracket': {
      const m = W;
      body = <path d={`M${i + W},${i} Q${i + m / 2},${i} ${i + m / 2},${i + H * 0.15} V${i + H * 0.4} Q${i + m / 2},${i + H / 2} ${i},${i + H / 2} Q${i + m / 2},${i + H / 2} ${i + m / 2},${i + H * 0.6} V${i + H * 0.85} Q${i + m / 2},${i + H} ${i + W},${i + H}`} {...common} fill="none" stroke={paint.stroke === 'transparent' ? paint.text : paint.stroke} />;
      break;
    }
    case 'cloud': case 'star':
      return (
        <svg className="shape-svg" width={w} height={h} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={kind === 'cloud' ? CLOUD : STAR} transform={kind === 'cloud' ? 'scale(1 1.5)' : undefined} {...common} vectorEffect="non-scaling-stroke" />
        </svg>
      );
  }
  return <svg className="shape-svg" width={w} height={h} aria-hidden="true">{body}</svg>;
}

export type Inset = { t: number; r: number; b: number; l: number };
const even = (x: number, y: number): Inset => ({ t: y, r: x, b: y, l: x });
// Where the label may sit inside the shape, as fractions of width (l, r) and height (t, b).
// A turned outline turns its label area with it (the text itself stays upright).
export function textInset(kind: ShapeKind, rotate = 0): Inset {
  let i: Inset;
  switch (kind) {
    case 'diamond': i = even(0.22, 0.22); break;
    case 'triangle': i = { t: 0.42, r: 0.22, b: 0.08, l: 0.22 }; break; // the wide lower part
    case 'oval': case 'star': i = even(0.15, 0.15); break;
    case 'hexagon': case 'trapezoid': case 'parallelogram': case 'parallelogram-flip': i = even(0.16, 0.05); break;
    case 'cylinder': i = even(0.06, 0.18); break;
    case 'cloud': i = even(0.18, 0.2); break;
    default: i = even(0.04, 0.04);
  }
  for (let q = ((rotate / 90) % 4 + 4) % 4; q > 0; q--) i = { t: i.l, r: i.t, b: i.r, l: i.b }; // a quarter turn clockwise
  return i;
}

// Small preview icons for the shape picker.
const ICON_BOX: Partial<Record<ShapeKind, [number, number]>> = {
  oval: [16, 16], diamond: [20, 16], triangle: [18, 16], cylinder: [14, 18], star: [18, 18], cross: [14, 14], bracket: [7, 18], line: [20, 4], hexagon: [20, 16], annotation: [20, 16],
};
export function ShapeIcon({ kind }: { kind: ShapeKind }) {
  const [w, h] = ICON_BOX[kind] ?? [20, 14];
  return <span className="shape-icon"><ShapeSvg kind={kind} w={w} h={h} paint={{ fill: 'none', stroke: 'currentColor', text: 'currentColor', dash: false }} /></span>;
}
