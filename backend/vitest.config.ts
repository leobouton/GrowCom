import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // On ignore node_modules et le dossier de build : sinon vitest tente d'exécuter
    // les fichiers de tests compilés (dist/**/*.test.js), incompatibles en CommonJS.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
