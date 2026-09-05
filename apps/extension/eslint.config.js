import app from '@vital/eslint-config/app';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.wxt/**', '**/*.html'],
  },
  ...app,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
      },
    },
  },
];
