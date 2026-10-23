import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://127.0.0.1:3100';
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': api, '/auth': api, '/mcp': api, '/files': api, '/oauth': api, '/.well-known': api, '/pragmatic.mcpb': api, '/collab': { target: 'ws://127.0.0.1:3100', ws: true } } },
});
