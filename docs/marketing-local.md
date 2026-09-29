# Site marketing growcom.fr — lancer le site en local

Le site marketing vit dans le dossier `/marketing`. C'est un site **statique** (Astro) : il ne dépend ni du backend, ni de la base de données, et peut être mis en ligne seul, bien avant l'app.

## Prérequis

- Node.js 22.12 ou plus récent (`node -v` pour vérifier)

## Première installation

```bash
cd marketing
npm install
```

## Lancer le site pendant qu'on travaille dessus

```bash
cd marketing
npm run dev
```

Puis ouvrir http://localhost:4321 dans le navigateur. Chaque modification de fichier s'affiche immédiatement.

## Vérifier la version finale (celle qui sera mise en ligne)

```bash
cd marketing
npm run build      # vérifie les types puis génère le site dans marketing/dist
npm run preview    # sert le contenu de marketing/dist sur http://localhost:4321
```

## Où modifier quoi

| Je veux… | Fichier |
| --- | --- |
| Changer un texte de la page d'accueil | `marketing/src/pages/index.astro` |
| Écrire un article de blog | Créer un fichier `.md` dans `marketing/src/content/blog/` (copier l'article existant comme modèle). Le nom du fichier devient l'adresse de l'article. |
| Changer l'email de contact, l'adresse de l'app | `marketing/src/lib/site.ts` |
| Compléter les mentions légales | `marketing/src/pages/mentions-legales.astro` (chercher « À compléter ») |
| Changer les couleurs ou les polices | `marketing/src/styles/global.css` (bloc `@theme`) |

Les articles de blog reçoivent automatiquement la typographie française (espaces insécables dans les nombres, devant « € », « % », « : », « ? »…) : on peut écrire normalement.

## Écrire un article de blog (et bien le référencer)

1. Copier `marketing/src/content/blog/paliers-marginaux-ou-taux-atteint.md` sous un nouveau nom, par exemple `rémunération-agent-commercial.md` → l'article sera à l'adresse `/blog/remuneration-agent-commercial` (préférer un nom sans accents).
2. En tête du fichier, remplir :
   - `title` : le titre affiché ;
   - `seoTitle` (facultatif) : le titre pour Google, 60 caractères maximum, si `title` est plus long ;
   - `description` : le résumé affiché par Google (110 à 160 caractères) ;
   - `publishedAt` : la date, au format `2026-10-15` ;
   - `image` (facultatif) : l'image de partage (voir ci-dessous) ;
   - `draft: true` pour préparer un article sans le publier.
3. `npm run build` : un **contrôle SEO automatique** bloque la construction si un titre ou une description manque, est en double, ou si un lien interne est cassé.

**Images de partage** (celles qui s'affichent quand on colle un lien dans LinkedIn, WhatsApp, un email) : elles sont décrites dans `marketing/scripts/generate-og.ts`. Pour en ajouter une, copier un bloc de la liste `CARDS`, puis `npm run generate:og` (Chrome doit être installé) et committer le fichier créé dans `public/og/`.

## Le simulateur

| Je veux… | Fichier |
| --- | --- |
| Changer les valeurs par défaut ou les scénarios pré-remplis | `marketing/src/simulator/state.ts` (`DEFAULT_STATE`, `SCENARIOS`) |
| Changer l'apparence du formulaire | `marketing/src/components/simulator/Simulator.tsx` |
| Changer l'apparence du résultat (bordereau, projection) | `marketing/src/components/simulator/ResultsPanel.tsx` |

Les paramètres de la simulation sont gardés dans l'adresse de la page (`?prix=285000&hon=5…`) : on peut la recharger ou envoyer le lien. Les paramètres de campagne (`utm_source`…) présents dans l'adresse sont conservés.

Tests du site : `cd marketing && npm test`.

## Le formulaire « Recevoir ce calcul en PDF »

Le formulaire envoie les demandes à `/api/lead`, la seule partie du site exécutée sur un serveur (un Cloudflare Worker).

Pour le tester sur ton ordinateur **sans rien envoyer à Brevo** :

```bash
cd marketing
cp .dev.vars.example .dev.vars   # une seule fois ; contient LEAD_TEST_MODE=1
npm run build
npx astro preview                # le site tourne dans le moteur de Cloudflare, sur http://localhost:4321
```

Le fichier `.dev.vars` n'est jamais enregistré dans Git. Pour tester avec le vrai Brevo, renseigne-y `BREVO_API_KEY`, `BREVO_LIST_ID` et `BREVO_SENDER_EMAIL` (voir `docs/deploiement.md`, étape 1) et retire `LEAD_TEST_MODE`.

| Je veux… | Fichier |
| --- | --- |
| Changer les textes du formulaire | `marketing/src/components/lead/LeadForm.tsx` |
| Changer l'email envoyé (au visiteur, ou l'alerte de rappel) | `marketing/src/lib/lead/emails.ts` |
| Changer le PDF du calcul | `marketing/src/lib/pdf/simulation-pdf.ts` |
| Changer le modèle de grille (Excel + PDF) | `marketing/scripts/generate-templates.ts`, puis `npm run generate:templates` |

## Règle importante

Le site n'a **aucun calcul de commission à lui**. Tous les montants (y compris l'exemple de la page d'accueil) sont calculés par le moteur partagé `shared/commission-engine`, le même que celui de l'app. Pour modifier un calcul, c'est là qu'il faut intervenir, avec des tests (`cd backend && npm test`).
