import { fromExcalidraw } from '../../../shared/excalidraw.ts';
import { newId, type BoardObject } from '../../../shared/model.ts';
import { api } from '../api.ts';

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('Image does not load'));
  img.src = src;
});

// SVG is not accepted by the server (it can carry script), so draw it to a PNG first.
async function toPng(dataURL: string, w: number, h: number): Promise<Blob> {
  const img = await loadImage(dataURL);
  const scale = 2, canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('PNG export failed'))), 'image/png'));
}

export async function imageObject(file: Blob, z: number, maxW = 960): Promise<BoardObject> {
  const { src, width, height } = await api.uploadImage(file);
  const w = Math.min(width ?? 800, maxW), h = width && height ? (w * height) / width : w * 0.75;
  return { id: newId(), z, type: 'image', x: 0, y: 0, w, h, src };
}

// Mermaid -> pragmatic objects. Flowcharts and sequence diagrams become shapes and connectors.
export async function mermaidObjects(definition: string, z0: number): Promise<BoardObject[]> {
  await document.fonts.load('18px Barlow');
  const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
  const { elements, files } = await parseMermaidToExcalidraw(definition, { themeVariables: { fontSize: '18px' } });
  const out = fromExcalidraw(elements as never, { z0, boundRoute: 'elbow' });
  let z = z0 + out.length;
  for (const e of elements as { type: string; fileId?: string; x?: number; y?: number; width?: number; height?: number }[]) {
    if (e.type !== 'image' || !e.fileId) continue;
    const file = (files as Record<string, { dataURL: string }> | undefined)?.[e.fileId];
    if (!file) continue;
    const w = e.width ?? 600, h = e.height ?? 400;
    const { src } = await api.uploadImage(await toPng(file.dataURL, w, h));
    out.push({ id: newId(), z: z++, type: 'image', x: e.x ?? 0, y: e.y ?? 0, w, h, src });
  }
  return out;
}
