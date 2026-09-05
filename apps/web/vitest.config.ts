import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      deps: {
        optimizer: {
          client: {
            enabled: true,
            include: [
              'react-dom',
              'react-dom/client',
              '@testing-library/react',
              'react-router',
              '@tiptap/react',
              '@tiptap/core',
              '@tiptap/starter-kit',
            ],
          },
        },
      },
    },
  }),
);
