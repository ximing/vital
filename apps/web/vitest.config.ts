import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./__tests__/setup.ts'],
      include: ['__tests__/**/*.test.{ts,tsx}'],
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
