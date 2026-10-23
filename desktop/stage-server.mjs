// Copies the pragmatic server and the web app into build/server with production modules only.
// after-pack.cjs puts that folder in the app's Resources; main.js runs it from there.
import { cpSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname, out = new URL('build/server/', import.meta.url).pathname;
execSync('npm run build', { cwd: root, stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
for (const p of ['server', 'shared', 'dist', 'package.json', 'package-lock.json'])
  cpSync(root + p, out + p, { recursive: true, filter: (f) => !f.endsWith('.test.ts') });
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
