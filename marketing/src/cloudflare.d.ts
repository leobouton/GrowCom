// Module fourni par l'environnement Cloudflare Workers : variables et secrets du Worker
// (définis dans le tableau de bord Cloudflare en production, dans .dev.vars en local).
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
