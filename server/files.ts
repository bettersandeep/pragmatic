import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequest } from './store.ts';

import { FILES_DIR } from './config.ts';
export { FILES_DIR };
mkdirSync(FILES_DIR, { recursive: true });

const MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
export type ImageType = keyof typeof IMAGE_TYPES;

// Sniff the real type from the first bytes; never trust the declared one. No SVG: it can carry script.
function sniff(b: Buffer): ImageType | null {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Pixel size from the header, where the format makes that cheap.
export function imageSize(b: Buffer, type: ImageType): { width?: number; height?: number } {
  if (type === 'image/png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (type === 'image/gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (type === 'image/jpeg') {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return {}; // ponytail: webp size not parsed, callers fall back to 4:3
}

export function saveImage(bytes: Buffer, declared?: string) {
  if (bytes.length > MAX_BYTES) throw new BadRequest('Image is larger than 20 MB');
  const type = sniff(bytes);
  if (!type) throw new BadRequest(`Not a PNG, JPEG, GIF or WebP image${declared ? ` (declared ${declared})` : ''}`);
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${IMAGE_TYPES[type]}`;
  const path = join(FILES_DIR, name);
  if (!existsSync(path)) writeFileSync(path, bytes);
  return { src: `/files/${name}`, ...imageSize(bytes, type) };
}
