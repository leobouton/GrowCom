// ESLint v9 — flat config (remplace l'ancien .eslintrc.json).
// Objectif : garder les garde-fous anti-bugs BLOQUANTS (error) et traiter le
// bruit de vérification de types stricte / faux positifs Express en informatif
// (warning, affiché mais non bloquant). `npm run lint` doit passer (exit 0).
const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  // Fichiers ignorés
  { ignores: ['dist/**', 'node_modules/**', 'prisma/**', 'scripts/**'] },

  // Code applicatif TypeScript
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Base : recommandations JS + TypeScript (SANS le sur-ensemble
      // « requiring-type-checking » qui génère surtout du bruit et des faux
      // positifs Express — remplacé par un opt-in ciblé ci-dessous).
      ...js.configs.recommended.rules,
      ...tsPlugin.configs['recommended'].rules,

      // Règles JS de base remplacées / inadaptées en TypeScript
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',

      // ── Garde-fous anti-bugs type-aware : réactivés explicitement (BLOQUANTS) ──
      // Oubli de `await` sur une promesse.
      '@typescript-eslint/no-floating-promises': 'error',
      // Async mal placé, MAIS on tolère les handlers Express async (void-return).
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

      // ── Réglages projet ──
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
