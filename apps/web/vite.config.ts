import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(rootDir, 'package.json'), 'utf8')) as {
  version: string;
};
const require = createRequire(import.meta.url);
// Pin one physical React (root overrides 19.1.0; Expo later must not duplicate dispatcher).
const reactRoot = path.dirname(require.resolve('react/package.json'));
const reactDomRoot = path.dirname(require.resolve('react-dom/package.json'));

/** Package name after the last `node_modules/` segment, query string stripped. */
function packageName(id: string): string | null {
  const clean = id.split('?')[0] ?? id;
  const parts = clean.split('/node_modules/');
  if (parts.length < 2) return null;
  const tail = parts[parts.length - 1] ?? '';
  if (tail.startsWith('@')) {
    const [scope, name] = tail.split('/');
    if (!scope || !name) return null;
    return `${scope}/${name}`;
  }
  const name = tail.split('/')[0];
  return name || null;
}

function isEditorPackage(name: string): boolean {
  return (
    name.startsWith('@tiptap/') ||
    name.startsWith('prosemirror-') ||
    name === 'linkifyjs' ||
    name === 'orderedmap' ||
    name === 'rope-sequence' ||
    name === 'w3c-keyname'
  );
}

function isMarkdownPackage(name: string): boolean {
  return (
    name === 'unified' ||
    name === 'markdown-table' ||
    name.startsWith('micromark') ||
    name.startsWith('mdast') ||
    name.startsWith('remark-') ||
    name.startsWith('vfile') ||
    name.startsWith('unist-util-')
  );
}

export default defineConfig({
  plugins: [react(), svgr(), tailwindcss()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
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
  build: {
    rollupOptions: {
      output: {
        // Last node_modules segment. A pnpm path can contain `@tiptap` higher up
        // while the file itself is react; matching the parent would preload the editor.
        manualChunks(id) {
          const name = packageName(id);
          if (!name) return undefined;
          if (name === 'react' || name === 'react-dom' || name === 'scheduler') return 'react';
          if (name === 'lucide-react') return 'icons';
          if (isEditorPackage(name)) return 'editor';
          if (isMarkdownPackage(name)) return 'markdown';
          if (
            name === 'react-router' ||
            name === 'zod' ||
            name === '@tanstack/react-query' ||
            name === '@tanstack/query-core' ||
            name.startsWith('@rabjs/')
          ) {
            return 'framework';
          }
          return undefined;
        },
      },
    },
  },
});
