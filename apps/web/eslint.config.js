import app from '@vital/eslint-config/app';
import globals from 'globals';

/** Cross-feature deep imports are banned; `query-keys` / `model` are cycle-break leaf modules. */
function featureBarrel(name) {
  return {
    group: [
      `@/features/${name}/*`,
      `@/features/${name}/**`,
      `!@/features/${name}/query-keys`,
      `!@/features/${name}/model`,
      `!@/features/${name}/*-ui.service`,
    ],
    message: `Import public ${name} API from @/features/${name}. query-keys, model, and *-ui.service are cycle-break exceptions.`,
  };
}

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
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/App.tsx', 'src/services/register.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Property[key.name="queryKey"] > ArrayExpression',
          message:
            'Use a feature query-key factory (todayKeys, todoKeys, inboxKeys, reportKeys, settingsKeys) instead of a queryKey literal.',
        },
        {
          selector: 'Property[key.name="queryKey"] > TSAsExpression > ArrayExpression',
          message:
            'Use a feature query-key factory (todayKeys, todoKeys, inboxKeys, reportKeys, settingsKeys) instead of a queryKey literal.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [featureBarrel('todos'), featureBarrel('inbox'), featureBarrel('today')],
        },
      ],
    },
  },
  {
    files: ['src/features/todos/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [featureBarrel('inbox'), featureBarrel('today')],
        },
      ],
    },
  },
  {
    files: ['src/features/inbox/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [featureBarrel('todos'), featureBarrel('today')],
        },
      ],
    },
  },
  {
    files: ['src/features/today/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [featureBarrel('todos'), featureBarrel('inbox')],
        },
      ],
    },
  },
  {
    // Shell and the palette stay on the first paint. The todos barrel re-exports
    // TaskDetail, so these files import the leaf module instead.
    files: ['src/shell/**/*.{ts,tsx}', 'src/features/palette/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@/features/todos(?:/index)?$',
              message:
                'The todos barrel re-exports TaskDetail. Import the leaf module so the notes editor stays off the shell.',
            },
            featureBarrel('inbox'),
            featureBarrel('today'),
          ],
        },
      ],
    },
  },
];
