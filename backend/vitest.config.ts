import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests du backend + ceux du moteur de calcul partagé (shared/commission-engine),
    // qui n'a pas de package à lui : c'est le backend qui les exécute.
    include: ['src/**/*.test.ts', '../shared/**/*.test.ts'],
    // On ignore node_modules et le dossier de build : sinon vitest tente d'exécuter
    // les fichiers de tests compilés (dist/**/*.test.js), incompatibles en CommonJS.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
