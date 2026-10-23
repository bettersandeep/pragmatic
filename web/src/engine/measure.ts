import { useEffect, useState } from 'react';
import type { Measure } from '../../../shared/mindmapLayout.ts';
import { isFormatted, richHTML } from './rich.tsx';

const ctx = document.createElement('canvas').getContext('2d')!;
const LINE = 1.3;

// Word-wrapped text size with the real font, matching the CSS of board text.
export const measureText: Measure = (text, px, weight, maxW, rich) => {
  if (rich && isFormatted(rich)) return measureRich(richHTML(rich), px, weight, maxW);
  ctx.font = `${weight} ${px}px Barlow, system-ui, sans-serif`;
  let lines = 0, widest = 0;
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && ctx.measureText(next.trimEnd()).width > maxW) {
        widest = Math.max(widest, ctx.measureText(line.trimEnd()).width);
        lines++;
        line = word.trimStart();
      } else line = next;
    }
    widest = Math.max(widest, ctx.measureText(line.trimEnd()).width);
    lines++;
  }
  return { w: Math.ceil(Math.min(widest, maxW)) + 1, h: Math.ceil(lines * px * LINE) };
};

// Formatted text is measured by the browser itself, in a hidden box with the board text styles.
let box: HTMLDivElement | null = null;
const seen = new Map<string, { w: number; h: number }>();
function measureRich(html: string, px: number, weight: number, maxW: number) {
  const k = `${px}|${weight}|${maxW}|${html}`, hit = seen.get(k);
  if (hit) return hit;
  if (!box) {
    box = document.createElement('div');
    box.className = 'text-static rich measure-box';
    box.setAttribute('aria-hidden', 'true');
    document.body.append(box);
  }
  Object.assign(box.style, { fontSize: `${px}px`, fontWeight: String(weight), maxWidth: `${maxW}px`, lineHeight: String(LINE) });
  box.innerHTML = html;
  const r = box.getBoundingClientRect(), out = { w: Math.ceil(Math.min(r.width, maxW)) + 1, h: Math.ceil(r.height) };
  if (seen.size > 2000) seen.clear();
  seen.set(k, out);
  return out;
}

// Re-render once the board font has loaded, so measurements use it.
export function useFontsReady() {
  const [ready, setReady] = useState(document.fonts.status === 'loaded');
  useEffect(() => {
    if (ready) return;
    let live = true;
    Promise.all(['400', '500', '600', '700', 'italic 500', 'italic 700'].map((w) => document.fonts.load(`${w} 18px Barlow`))).then(() => { seen.clear(); if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);
  return ready;
}
