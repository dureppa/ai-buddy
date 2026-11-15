import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.venv/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      '{web,extension,ops/service-sites}/frontend/**/*.{ts,tsx}',
      'corporate-services/**/frontend/**/*.{ts,tsx}',
      'tools/jira/frontend/**/*.{ts,tsx}',
      'corporate-services/access/frontend/**/*.{ts,tsx}',
      'tools/confluence/frontend/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        globalThis: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDialogElement: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        KeyboardEvent: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Storage: 'readonly',
        URL: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
