import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import nounsanitized from 'eslint-plugin-no-unsanitized';

const FETCH_MESSAGE = 'fetch is only allowed in src/lib/provider/ (CLAUDE.md §4)';

export default defineConfig([
  globalIgnores(['node_modules/', '.output/', '.wxt/', '.worktrees/', 'bench/results/']),
  tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    plugins: { nounsanitized },
    rules: {
      'nounsanitized/method': 'error',
      'nounsanitized/property': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': 'error',
      'no-restricted-globals': ['error', { name: 'fetch', message: FETCH_MESSAGE }],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'fetch', message: FETCH_MESSAGE },
        { object: 'window', property: 'fetch', message: FETCH_MESSAGE },
        { object: 'self', property: 'fetch', message: FETCH_MESSAGE },
      ],
    },
  },
  {
    files: ['src/lib/provider/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/lib/log.ts', 'bench/**/*.ts', 'scripts/**/*.mjs', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
]);
