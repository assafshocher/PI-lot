import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  base: '/pia/',
  define: { 'import.meta.env.VITE_BROWSER_DEMO': '"true"' },
  plugins: [react(), { name: 'browser-demo-entry', transformIndexHtml: { order: 'pre', handler(html) { return html.replace('/src/main.tsx', '/src/browser-demo.tsx').replace('A private research workspace for people, projects and deadlines.', 'Explore a fictional research lab. No login required; edits stay in your browser.').replace('<title>PIA ·', '<title>PIA Demo ·'); } } }],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: { outDir: 'dist-demo', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
