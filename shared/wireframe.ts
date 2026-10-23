import { DEFAULTS, DEVICES, FRAME_Z, WF_DEFAULTS, frameScreen, newId, type BoardObject, type Device, type FrameObj, type WfObj } from './model.ts';

export type WfSpec = Partial<Omit<WfObj, 'id' | 'z' | 'type'>> & Pick<WfObj, 'kind'>;
export type WireframeSpec = { device?: Device; title?: string; landscape?: boolean; components: WfSpec[] };

// Components that fill the screen width when stacked automatically.
const STRETCH = new Set(['input', 'textarea', 'dropdown', 'htabs', 'divider', 'lorem', 'blockfont', 'progress', 'slider', 'image', 'video', 'map']);
const PAD = 16, GAP = 12, LABEL_H = 22;

// A device frame with its components, at the origin. Component x/y are relative to the frame's screen;
// components without a position stack top to bottom.
export function buildWireframe(spec: WireframeSpec, z0: number): BoardObject[] {
  const d = spec.device ? DEVICES[spec.device] : null;
  const frame: FrameObj | null = d && spec.device ? {
    ...DEFAULTS.frame, id: newId(), z: FRAME_Z + z0, type: 'frame', device: spec.device, title: spec.title ?? '',
    x: 0, y: 0, w: spec.landscape ? d.h : d.w, h: spec.landscape ? d.w : d.h,
  } : null;
  const screen = frame ? frameScreen(frame) : { x: 0, y: 0, w: 360, h: Infinity };
  let cursor = PAD, z = z0 + 1;
  const parts = spec.components.map((c): WfObj => {
    const def = WF_DEFAULTS[c.kind];
    const w = c.w ?? (STRETCH.has(c.kind) && c.x === undefined ? screen.w - 2 * PAD : def.w);
    const h = c.h ?? def.h + (c.label ? LABEL_H : 0);
    const x = c.x ?? PAD, y = c.y ?? cursor;
    if (c.y === undefined) cursor += h + GAP;
    return { ...DEFAULTS.wf, ...def, ...c, id: newId(), z: z++, type: 'wf', x: screen.x + x, y: screen.y + y, w, h } as WfObj;
  });
  return frame ? [frame, ...parts] : parts;
}
