import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// Pin one physical React (root overrides 19.1.0; Expo later must not duplicate dispatcher).
const reactRoot = path.dirname(require.resolve('react/package.json'));
const reactDomRoot = path.dirname(require.resolve('react-dom/package.json'));
const emojibaseRoot = path.dirname(require.resolve('emojibase-data/package.json'));

function emojibasePlugin(): Plugin {
  return {
    name: 'emojibase-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/emojibase/')) return next();
        const rel = decodeURIComponent(req.url.slice('/emojibase/'.length).split('?')[0] ?? '');
        if (rel.includes('..')) return next();
        const file = path.join(emojibaseRoot, rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const dest = path.resolve(rootDir, 'dist/emojibase');
      for (const locale of ['zh', 'en']) {
        const from = path.join(emojibaseRoot, locale);
        if (existsSync(from)) cpSync(from, path.join(dest, locale), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), svgr(), tailwindcss(), emojibasePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      react: reactRoot,
      'react-dom': reactDomRoot,
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  // Keep rust compiler output visible when `tauri dev` owns the terminal.
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
