import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Spec rule 4: the widget runs in an iframe on another site, where cookies and storage may be
// blocked. Keep state in memory; if storage is ever needed, wrap it in try/catch and disable
// this rule on that line with a reason.
const STORAGE_MESSAGE =
  'Spec rule 4: the widget must not rely on cookies or storage. Keep state in memory.';
const storageGlobals = ['localStorage', 'sessionStorage', 'indexedDB'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'web/playwright-report/**',
    'web/test-results/**',
    'server/.mail-preview/**',
    'server/test/fixtures/**',
  ]),

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./server/tsconfig.json', './web/tsconfig.app.json', './web/tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['server/**/*.ts', 'web/*.config.ts', 'web/e2e/**/*.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['web/src/**/*.{ts,tsx}', 'web/test/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.configs.recommended],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ['web/src/**/*.tsx'],
    extends: [reactRefresh.configs.vite],
  },

  {
    files: ['web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...storageGlobals.map((name) => ({ name, message: STORAGE_MESSAGE })),
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          storageGlobals.map((property) => ({ object, property, message: STORAGE_MESSAGE })),
        ),
        { object: 'document', property: 'cookie', message: STORAGE_MESSAGE },
      ],
    },
  },

  // embed.js runs on other people's pages: plain browser script, older syntax.
  {
    files: ['server/static/embed.js'],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: 'script',
      globals: { ...globals.browser, __ADN_EMBED_CONFIG__: 'readonly' },
    },
    // ES2017 has no `catch {}` without a binding.
    rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },

  prettier,
]);
