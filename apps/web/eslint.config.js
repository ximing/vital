import app from '@vital/eslint-config/app';
import globals from 'globals';

export default [
  ...app,
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
