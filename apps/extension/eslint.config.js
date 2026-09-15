import app from '@vital/eslint-config/app';

export default [
  {
    ignores: ['**/dist/**', '**/dist-store/**', '**/node_modules/**', '**/.wxt/**', '**/*.html'],
  },
  ...app,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
      },
    },
  },
];
