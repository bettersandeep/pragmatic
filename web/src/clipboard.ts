// The clipboard API exists only on https and localhost. A team server on plain http over a local network has none,
// so text copies fall back to the older copy command, and picture copies say what to do instead.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('the browser did not allow copying');
}

const NEEDS_HTTPS = 'copying pictures needs https (or localhost); use Export to download it instead';
// Pictures and other types; `data` may still be rendering (keeps the click's permission while it does).
export async function copyBlob(type: string, data: Blob | Promise<Blob>): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error(NEEDS_HTTPS);
  await navigator.clipboard.write([new ClipboardItem({ [type]: data })]);
}

// The menu's Paste reads the clipboard itself; without the API, ⌘V still works (the browser's own paste event).
export async function readClipboard(): Promise<ClipboardItems> {
  if (!navigator.clipboard?.read) throw new Error('use ⌘V (Ctrl+V) to paste here');
  return navigator.clipboard.read();
}
