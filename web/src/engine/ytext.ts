import { createContext } from 'react';
import type * as Y from 'yjs';
import { applyTextDiff } from '../../../shared/doc.ts';

// The shared text of an object's field (see textOf in shared/doc.ts); Canvas provides it to the editors.
export const TextSource = createContext<((id: string, key: string) => Y.Text | null) | null>(null);

type Field = HTMLTextAreaElement | HTMLElement;
const isArea = (el: Field): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement;
const read = (el: Field) => (isArea(el) ? el.value : el.innerText.replace(/\n$/, ''));

function caret(el: Field): [number, number] | null {
  if (isArea(el)) return [el.selectionStart, el.selectionEnd];
  const sel = getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return null;
  const at = (node: Node, off: number) => { const r = document.createRange(); r.selectNodeContents(el); r.setEnd(node, off); return r.toString().length; };
  const r = sel.getRangeAt(0);
  return [at(r.startContainer, r.startOffset), at(r.endContainer, r.endOffset)];
}

function setCaret(el: Field, [a, b]: [number, number]) {
  if (isArea(el)) return el.setSelectionRange(a, b);
  const node = el.firstChild ?? el, len = node.textContent?.length ?? 0, r = document.createRange();
  r.setStart(node, Math.min(a, len));
  r.setEnd(node, Math.min(b, len));
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(r);
}

// Where a caret index ends up after someone else's change.
function shift(pos: number, delta: Y.YTextEvent['delta']) {
  let i = 0;
  for (const d of delta) {
    if (d.retain) i += d.retain;
    else if (typeof d.insert === 'string') { if (i <= pos) pos += d.insert.length; i += d.insert.length; }
    else if (d.delete) { if (i < pos) pos -= Math.min(d.delete, pos - i); }
  }
  return pos;
}

// Live two-way binding of a text box to shared text: each keystroke becomes a small change, and other
// people's typing shows up at once without moving the caret.
export function bindText(el: Field, t: Y.Text, origin: unknown) {
  let applying = false;
  const write = (v: string) => { if (isArea(el)) el.value = v; else el.textContent = v; };
  if (read(el) !== t.toString()) write(t.toString());
  const onInput = () => { applying = true; try { applyTextDiff(t, read(el), origin); } finally { applying = false; } };
  const onRemote = (e: Y.YTextEvent) => {
    if (applying) return;
    const c = caret(el);
    write(t.toString());
    if (c && document.activeElement === el) setCaret(el, [shift(c[0], e.delta), shift(c[1], e.delta)]);
    el.dispatchEvent(new Event('remote-input')); // lets the editor re-measure its size
  };
  el.addEventListener('input', onInput);
  t.observe(onRemote);
  return () => { el.removeEventListener('input', onInput); t.unobserve(onRemote); };
}
