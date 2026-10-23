import type { Rect } from '../../../shared/layout.ts';

// Export what the board shows: clone the rendered objects into an SVG <foreignObject>,
// with the page's CSS, the board font and all images inlined, so it matches the screen.

const toDataUrl = (blob: Blob) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = fail; r.readAsDataURL(blob); });

let fontCss: Promise<string> | null = null;
// @font-face rules with their woff2 files inlined (cached).
function inlineFonts(): Promise<string> {
  return (fontCss ??= (async () => {
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of [...rules]) {
        if (!(r instanceof CSSFontFaceRule) || !/barlow/i.test(r.style.getPropertyValue('font-family'))) continue;
        let css = r.cssText;
        for (const [, url] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          if (url.startsWith('data:')) continue;
          try { css = css.replace(url, await toDataUrl(await (await fetch(new URL(url, sheet.href ?? location.href))).blob())); } catch { /* keep the URL */ }
        }
        out.push(css);
      }
    }
    return out.join('\n');
  })());
}

function pageCss(): string {
  return [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].filter((r) => !(r instanceof CSSFontFaceRule)).map((r) => r.cssText); } catch { return []; } }).join('\n');
}

export async function boardSvg(world: HTMLElement, area: Rect, opts: { background: string | null; theme: string; only?: Set<string> }): Promise<string> {
  const pad = 32, w = Math.ceil(area.w + pad * 2), h = Math.ceil(area.h + pad * 2);
  const clone = world.cloneNode(true) as HTMLElement;
  clone.style.transform = `translate(${pad - area.x}px, ${pad - area.y}px)`;
  clone.querySelectorAll('.focus').forEach((e) => e.classList.remove('focus'));
  if (opts.only) {
    clone.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => { if (!opts.only!.has(e.dataset.id!)) e.remove(); });
  }
  clone.querySelectorAll('.draft-line, .draft-box').forEach((e) => e.remove());
  for (const img of [...clone.querySelectorAll('img')]) {
    try { img.src = await toDataUrl(await (await fetch(img.src)).blob()); } catch { img.remove(); }
  }
  const html = new XMLSerializer().serializeToString(clone);
  const css = `${await inlineFonts()}\n${pageCss()}`.replace(/]]>/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<foreignObject x="0" y="0" width="${w}" height="${h}">
<div xmlns="http://www.w3.org/1999/xhtml" class="canvas theme-${opts.theme}" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${opts.background ?? 'transparent'};font-family:Barlow,system-ui,sans-serif">
<style><![CDATA[${css}]]></style>${html}</div></foreignObject></svg>`;
}

export async function svgToPng(svg: string, scale: number): Promise<Blob> {
  const img = new Image();
  img.decoding = 'sync';
  // A data: URL; Chrome taints the canvas for a blob: URL SVG that holds a foreignObject.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  {
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('Board image did not render')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('PNG export failed'))), 'image/png'));
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
