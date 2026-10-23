import { isBox, isContainer, newId, type BoardObject, type ConnectorObj, type End } from './model.ts';
import { connectorGeometry, type Pt } from './route.ts';

// Copy objects with fresh ids. Connectors keep bindings inside the copied set;
// a binding to an object outside the set becomes a free end at its current position.
export function cloneObjects(objs: BoardObject[], all: Map<string, BoardObject>, dx: number, dy: number, z0: number): BoardObject[] {
  const ids = new Map(objs.map((o) => [o.id, newId()]));
  // Copies form their own groups, so a duplicate never joins the original's group.
  const groups = new Map<string, string>();
  const group = (g?: string) => (g ? (groups.get(g) ?? groups.set(g, newId()).get(g)) : undefined);
  let z = z0;
  return objs.map((raw) => {
    const o = { ...raw, group: group(raw.group) } as BoardObject;
    const id = ids.get(o.id)!;
    if (isBox(o)) return { ...o, id, x: o.x + dx, y: o.y + dy, z: isContainer(o) ? o.z : z++, locked: false };
    const g = connectorGeometry(o, all);
    const remap = (e: End, p: Pt | undefined): End =>
      e.id && ids.has(e.id) ? { ...e, id: ids.get(e.id) } : e.id ? { x: (p?.x ?? 0) + dx, y: (p?.y ?? 0) + dy } : { x: e.x! + dx, y: e.y! + dy };
    return { ...o, id, z: z++, from: remap(o.from, g?.start), to: remap(o.to, g?.end) } as ConnectorObj;
  });
}

// Copy with the connectors that run between the selected objects.
export function withInnerConnectors(ids: string[], objs: BoardObject[]): BoardObject[] {
  const set = new Set(ids);
  return objs.filter((o) => set.has(o.id) || (o.type === 'connector' && o.from.id && o.to.id && set.has(o.from.id) && set.has(o.to.id)));
}
