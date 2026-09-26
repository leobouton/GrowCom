// ESLint v9 — flat config (frontend React + TypeScript).
// Le package frontend est en ESM ("type": "module"), donc syntaxe `import`.
// Même philosophie que le backend : garder les garde-fous anti-bugs BLOQUANTS
// (error) et traiter le bruit de style / typage strict en informatif (warning,
// affiché mais non bloquant). `npm run lint` doit passer (exit 0).
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // Fichiers ignorés
  { ignores: ['dist/**', 'node_modules/**', 'build/**'] },

  // Code applicatif React + TypeScript
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // Base : recommandations JS + TypeScript (sans type-checking, pour rester
      // rapide et sans configuration de projet TS côté lint).
      ...js.configs.recommended.rules,
      ...tsPlugin.configs['recommended'].rules,

      // ── Garde-fou anti-bug BLOQUANT : mauvais usage des Hooks React ──
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Règles JS de base remplacées / inadaptées en TypeScript
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',

      // ── Bruit traité en informatif (non bloquant) ──
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
