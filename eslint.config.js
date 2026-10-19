import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // stdout is the Native Messaging channel: any console.* call in the host corrupts it.
    files: ['packages/host/src/**/*.ts'],
    ignores: ['packages/host/src/**/*.test.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['packages/extension/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    files: ['**/*.mjs', 'packages/host/**/*.ts', 'packages/*/test/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
