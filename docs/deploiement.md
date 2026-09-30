# Mise en ligne de growcom.fr

Ce guide met en ligne **le site marketing** (`/marketing`) : landing, simulateur, modèle de grille, blog.
Il ne dépend **ni du backend, ni de la base de données** : il peut être en ligne bien avant l'app.

> Rien n'est déployé automatiquement : chaque étape ci-dessous est à faire par toi, dans l'ordre.
> Compte environ 1 h la première fois (dont beaucoup d'attente de propagation DNS).

---

## Vue d'ensemble

| Élément | Où | Coût |
| --- | --- | --- |
| Site (pages statiques + formulaire `/api/lead`) | **Cloudflare Workers** | Gratuit (pages illimitées, 100 000 envois de formulaire / jour) |
| Anti-robot du formulaire | Cloudflare Turnstile | Gratuit |
| Contacts et emails | Brevo | Offre gratuite suffisante au départ |
| DNS de `growcom.fr` | Cloudflare (gratuit) | Le domaine reste chez ton registrar actuel |

**Pourquoi « Workers » et pas « Pages » ?** L'outil qui construit le site (Astro) ne sait plus publier sur Cloudflare Pages ; Cloudflare recommande désormais Workers, qui fait la même chose (et plus). Même compte, même gratuité.

### Ordre conseillé

Les étapes sont numérotées par thème, mais **fais-les dans cet ordre** : chacune a besoin de la précédente.

1. **Étape 2** — DNS chez Cloudflare (le reste en dépend).
2. **Étape 5.4** — boîte `leo.bouton@growcom.fr` : **à sauter** si l'adresse reçoit déjà des emails (c'est le cas : messagerie OVH relevée dans Gmail ; on garde alors tels quels les enregistrements MX, SRV, SPF et les CNAME `imap`, `smtp`, `pop3`, `mail`, `autoconfig`, `autodiscover`, en « DNS uniquement »).
3. **Étape 1** — Brevo.
4. **Étape 3** — Turnstile (déjà fait).
5. **Étape 4** — publication, puis **étape 5.2** (redirection www).
6. **Étape 6** — tests.

---

## Étape 1 — Préparer Brevo

1. **Liste de contacts** : Brevo › Contacts › Listes › *Créer une liste*, par exemple « Site growcom.fr ». Note son **identifiant** (nombre affiché dans la colonne ID) → `BREVO_LIST_ID`.
2. **Attributs de contact** : Brevo › Contacts › Paramètres › Attributs de contact › *Ajouter un attribut*. Crée exactement ceux-ci :

   | Nom | Type |
   | --- | --- |
   | `AGENCE` | Texte |
   | `VILLE` | Texte |
   | `TELEPHONE` | Texte |
   | `RAPPEL_DEMANDE` | Booléen |
   | `SOURCE` | Texte |
   | `DATE_DEMANDE` | Date |
   | `LIEN_SIMULATION` | Texte |
   | `UTM_SOURCE`, `UTM_MEDIUM`, `UTM_CAMPAIGN`, `UTM_CONTENT`, `UTM_TERM`, `CAMPAGNE_ID` | Texte |

   Le prénom utilise l'attribut déjà présent : `PRENOM` sur un compte en français (sinon `FIRSTNAME` : dans ce cas, renseigne `BREVO_FIRSTNAME_ATTRIBUTE=FIRSTNAME` à l'étape 4).
   Si un attribut manque, le contact est quand même enregistré (email seul) et une alerte apparaît dans les journaux du Worker.
3. **Expéditeur** : Brevo › Expéditeurs, domaines et IP dédiées › *Domaines* › ajouter `growcom.fr`. Brevo affiche des enregistrements DNS (DKIM, code Brevo, DMARC) : tu les ajouteras à l'étape 5. Puis *Expéditeurs* › ajouter par exemple `bonjour@growcom.fr` → `BREVO_SENDER_EMAIL`.
4. **Clé API** : Brevo › profil (en haut à droite) › *SMTP & API* › onglet *Clés API* › *Générer une nouvelle clé API*, nom « Site growcom.fr ». Copie-la tout de suite → `BREVO_API_KEY`. **C'est un secret : ne la colle jamais dans un fichier du projet ni dans un message.**
   ⚠️ Si Brevo › Sécurité › *IP autorisées* est activé, désactive le blocage pour cette clé : les serveurs Cloudflare n'ont pas d'adresse fixe.

> L'app (backend) utilise une autre clé Brevo, de type SMTP (`BREVO_SMTP_KEY`) : les deux coexistent sans problème.

---

## Étape 2 — Mettre le DNS de growcom.fr chez Cloudflare

Nécessaire pour brancher le domaine sur le Worker. Le domaine **reste acheté chez ton registrar** (OVH, Gandi, IONOS…) : seule la gestion du DNS déménage.

1. Crée un compte sur [dash.cloudflare.com](https://dash.cloudflare.com) (gratuit).
2. *Ajouter un domaine* › `growcom.fr` › offre **Free**. Cloudflare importe les enregistrements existants : vérifie que tes enregistrements **MX** (réception des emails sur ton domaine), s'il y en a, sont bien présents.
   Supprime au passage les enregistrements **A**, **AAAA** ou **CNAME** nommés `growcom.fr` et `www` : ce sont ceux de la page de parking d'OVH ; le site les remplacera à l'étape 4.
3. **Chez OVH, désactive d'abord le DNSSEC** (sinon le domaine devient injoignable au changement de serveurs) : [ovh.com/manager](https://www.ovh.com/manager) › *Web Cloud* › *Noms de domaine* › `growcom.fr` › onglet *Informations générales* › rubrique *Sécurité* › *DNSSEC* : **désactivé**. Attends que le changement soit effectif (quelques minutes à quelques heures, OVH l'indique).
4. Cloudflare te donne **deux serveurs de noms** (ex. `ada.ns.cloudflare.com`). Chez OVH : *Noms de domaine* › `growcom.fr` › onglet **Serveurs DNS** › **Modifier les serveurs DNS** › remplace `dns109.ovh.net` et `ns109.ovh.net` par les deux serveurs Cloudflare › *Appliquer la configuration*.
5. Dans Cloudflare, clique sur *Vérifier les serveurs de noms maintenant*, puis attends l'email « growcom.fr est actif » (de quelques minutes à 24 h ; OVH annonce jusqu'à 48 h).
6. (Facultatif, plus tard) Réactiver le DNSSEC côté Cloudflare : `growcom.fr` › *DNS* › *Paramètres* › *Activer DNSSEC*, puis coller chez OVH (onglet *Enregistrements DS*) les valeurs affichées.

---

## Étape 3 — Créer la protection anti-robot (Turnstile)

**À quoi ça sert.** Sans protection, des robots rempliraient ton formulaire avec de fausses adresses : ta liste Brevo se remplirait de déchets et Brevo enverrait des emails à des inconnus, ce qui abîme la réputation de ton domaine. Turnstile est le service gratuit de Cloudflare qui vérifie, avant l'envoi, que c'est bien un humain qui remplit le formulaire.

**Ce que voit le visiteur.** Dans la grande majorité des cas, **rien** : la vérification se fait en arrière-plan. Parfois, si Cloudflare a un doute, une petite case « Vérifiez que vous êtes humain » apparaît au-dessus du bouton d'envoi.

> ✅ **Déjà fait** : tu as créé le widget et la clé de site (`0x4AAAAAAFKewNncRWgg1MA3`) est intégrée dans le code (`marketing/src/lib/site.ts`). Il ne te reste que la **clé secrète**, à coller à l'étape 4.4. La suite de cette étape sert de référence.

**Durée** : 5 minutes. Cette étape ne dépend pas des autres : tu peux la faire avant même d'avoir déplacé le DNS (étape 2), il suffit d'avoir un compte Cloudflare.

### 3.1 Créer le « widget »

1. Connecte-toi sur [dash.cloudflare.com](https://dash.cloudflare.com).
2. Dans le menu de gauche, clique sur **Turnstile** (si tu ne le vois pas, tape « Turnstile » dans la barre de recherche en haut du tableau de bord).
3. Clique sur **Ajouter un widget** (*Add widget*).
4. Remplis :

   | Champ | Valeur | Pourquoi |
   | --- | --- | --- |
   | Nom du widget (*Widget name*) | `Formulaire growcom.fr` | Juste pour t'y retrouver |
   | Noms d'hôte (*Hostnames*) | `growcom.fr` (ajoute aussi `www.growcom.fr`, par précaution) | Le widget ne fonctionnera que sur ton site : personne ne peut réutiliser tes clés ailleurs |
   | Mode (*Widget Mode*) | **Géré** (*Managed*) | Cloudflare n'affiche la petite case qu'en cas de doute |
   | Pré-autorisation (*Pre-clearance*) | **Non** | Inutile ici |

5. Clique sur **Créer** (*Create*).

### 3.2 Récupérer les deux clés

Cloudflare affiche alors **deux clés** :

| Clé | Ressemble à | Secrète ? | Où elle servira |
| --- | --- | --- | --- |
| **Clé de site** (*Site Key*) | `0x4AAAAAAA…` | **Non** : elle est visible par tous dans le code de la page, c'est normal | Déjà intégrée dans le code (`marketing/src/lib/site.ts`) : si tu recrées un widget, donne la nouvelle à Claude ou remplace-la dans ce fichier |
| **Clé secrète** (*Secret Key*) | `0x4AAAAAAA…` (plus longue) | **Oui** : c'est un mot de passe | Étape 4.4, secret `TURNSTILE_SECRET_KEY` |

Copie-les dans un endroit sûr (ton gestionnaire de mots de passe, ou une note privée). Tu pourras toujours les retrouver dans Cloudflare › *Turnstile* › ton widget › *Paramètres*.

⚠️ **Ne colle jamais la clé secrète** dans un message, un email, un fichier du projet ou une conversation avec une IA. La clé de site, elle, peut être partagée sans risque.

### 3.3 Comment le site les utilise

- La **clé de site** est intégrée dans la page ; elle n'est activée que sur `growcom.fr` (sur ton ordinateur, le formulaire fonctionne sans). Le navigateur du visiteur l'utilise pour demander à Cloudflare « est-ce un humain ? » et reçoit un jeton.
- Le formulaire envoie ce jeton avec la demande. Le serveur (le Worker) le fait vérifier par Cloudflare grâce à la **clé secrète**. Si Cloudflare répond « robot », la demande est refusée et rien n'arrive dans Brevo.
- Les deux clés vont **ensemble** et doivent venir du même widget. Tant que la clé secrète n'est pas enregistrée dans Cloudflare (étape 4.4), le serveur ne fait pas la vérification : le formulaire fonctionne, protégé seulement par les autres barrières (champ piège, limitation du nombre d'envois, délai minimal).

**Vérification après la mise en ligne** : remplis le formulaire du simulateur toi-même. Si l'écran « C'est prêt » apparaît et que tu reçois l'email, Turnstile fonctionne. Si un message « La vérification anti-robot a échoué » s'affiche, vérifie que les deux clés viennent bien du même widget et que `growcom.fr` figure dans ses noms d'hôte.

---

## Étape 4 — Déployer le site

Le plus simple : Cloudflare construit et publie le site à chaque `git push` sur la branche `main`.

1. Le code doit être sur GitHub (dépôt privé possible).
2. Cloudflare › *Workers & Pages* › *Créer* › *Importer un dépôt* › choisis le dépôt GrowCom.
3. Réglages de construction :

   | Réglage | Valeur |
   | --- | --- |
   | Nom du projet | `growcom-marketing` (doit correspondre à `marketing/wrangler.jsonc`) |
   | Répertoire racine | `marketing` |
   | Commande de build | `npm run build` |
   | Commande de déploiement | `npx wrangler deploy` |
   | Variables de build | `NODE_VERSION` = `22` |

   Le build lit aussi le dossier `/shared` (moteur de calcul) : c'est normal, Cloudflare récupère tout le dépôt.
   Le déploiement **branche lui-même** `growcom.fr` et `www.growcom.fr` sur le site (déclarés dans `marketing/wrangler.jsonc`) : l'étape 2 (DNS chez Cloudflare) doit donc être terminée avant.
   Si le premier déploiement échoue avec un message du type *« Hostname already has externally managed DNS records »* : Cloudflare › `growcom.fr` › *DNS* › supprime les enregistrements **A**, **AAAA** ou **CNAME** nommés `growcom.fr` (ou `@`) et `www` (ce sont ceux de l'ancien hébergeur ou de la page de parking du registrar ; **ne touche pas** aux enregistrements MX et TXT), puis *Réessayer* le déploiement.
4. Une fois le premier déploiement terminé : Worker `growcom-marketing` › *Paramètres* › *Variables et secrets* › ajoute les valeurs ci-dessous, **toutes en type « Secret »** (c'est le plus simple : rien n'est jamais effacé ni affiché) :

   | Nom | Type | Valeur |
   | --- | --- | --- |
   | `BREVO_API_KEY` | **Secret** | clé API Brevo (étape 1) |
   | `TURNSTILE_SECRET_KEY` | **Secret** | clé secrète Turnstile (étape 3) |
   | `UNSUBSCRIBE_SECRET` | **Secret** | une longue phrase aléatoire, inventée par toi (chiffre les liens de désinscription ; ne jamais la changer ensuite, sinon les liens des anciens emails ne marchent plus) |
   | `BREVO_LIST_ID` | Texte | identifiant de la liste (étape 1) |
   | `BREVO_SENDER_EMAIL` | Texte | `leo.bouton@growcom.fr` (l'expéditeur validé dans Brevo à l'étape 1.3) |
   | `BREVO_SENDER_NAME` | Texte | `GrowCom` |
   | `LEAD_NOTIFY_EMAIL` | Texte | ton adresse : tu y reçois une alerte quand quelqu'un laisse son numéro |
   | `BREVO_FIRSTNAME_ATTRIBUTE` | Texte | seulement si ton attribut prénom s'appelle `FIRSTNAME` |

   ⚠️ **Ne définis jamais `LEAD_TEST_MODE` en production** (il sert à tester le formulaire sans Brevo).
   Ces valeurs ne sont écrites dans aucun fichier du projet ; elles sont conservées à chaque nouveau déploiement (les secrets toujours, et les variables « Texte » grâce au réglage `keep_vars` de `marketing/wrangler.jsonc`).
5. Déclenche un nouveau déploiement (*Déploiements* › *Réessayer*) pour que tout soit pris en compte.

**Alternative en ligne de commande** (depuis ton ordinateur, dossier `marketing`) : `npx wrangler login`, puis `npm run build`, puis `npx wrangler deploy`, et pour chaque secret `npx wrangler secret put BREVO_API_KEY` (la valeur est demandée, jamais affichée).

---

## Étape 5 — Brancher le domaine

1. ✅ **Automatique** : le déploiement (étape 4) a déjà branché `growcom.fr` et `www.growcom.fr`, avec leurs certificats HTTPS. Vérifie simplement dans Worker `growcom-marketing` › *Paramètres* › *Domaines et routes* que les deux apparaissent (les certificats peuvent mettre quelques minutes).
2. **Rediriger www vers growcom.fr** : Cloudflare › `growcom.fr` › *Règles* › *Règles de redirection* › *Créer à partir d'un modèle* › « Rediriger de WWW vers la racine » (301). Une seule adresse officielle, c'est mieux pour le référencement.
3. **Emails Brevo** : Cloudflare › `growcom.fr` › *DNS* › ajoute les enregistrements affichés par Brevo à l'étape 1.3 (TXT `brevo-code`, DKIM, DMARC), en mode **DNS uniquement** (nuage gris). Puis dans Brevo, clique *Authentifier*.
4. **Recevoir les emails sur `leo.bouton@growcom.fr`** (adresse affichée sur le site) : si tu n'as pas déjà une messagerie sur ce domaine, Cloudflare le fait gratuitement. `growcom.fr` › *Email* › *Email Routing* › *Commencer* › adresse personnalisée `leo.bouton` › destination : ta boîte Gmail habituelle (Cloudflare t'envoie un email de confirmation). Cloudflare ajoute lui-même les enregistrements DNS nécessaires. Les emails envoyés à `leo.bouton@growcom.fr` arrivent alors dans ta boîte habituelle.
5. **Sous-domaine `app`** : ne crée rien pour l'instant. Il est réservé à l'app (voir plus bas).

---

## Étape 5 bis — Activer les statistiques de visite (sans cookie)

Cloudflare › *Analytics & Logs* › *Web Analytics* › *Ajouter un site* › `growcom.fr`.
- Si Cloudflare propose l'**installation automatique**, active-la : rien d'autre à faire.
- Sinon, copie le **jeton** affiché (dans l'extrait de code, la valeur de `"token"`) et ajoute la variable de build `PUBLIC_CF_ANALYTICS_TOKEN` (Worker › *Paramètres* › *Build* › *Variables*), puis redéploie. Le site n'ajoute le script de mesure que si ce jeton existe.

Cet outil ne dépose aucun cookie : pas de bandeau de consentement à prévoir (voir `docs/rgpd.md`).

## Étape 6 — Vérifier après la mise en ligne

- [ ] `https://growcom.fr` s'affiche, en HTTPS ; `https://www.growcom.fr` redirige vers `https://growcom.fr`.
- [ ] `https://growcom.fr/simulateur-commission-negociateur-immobilier` calcule en direct.
- [ ] Une adresse inexistante (ex. `/test`) affiche la page « Cette page n'est dans aucun palier ».
- [ ] Formulaire du simulateur avec **ta propre adresse** et ton numéro : l'écran « C'est prêt » apparaît, le PDF se télécharge, tu reçois l'email avec les liens **et** l'alerte de rappel.
- [ ] Dans l'email reçu, le lien « se désinscrire en un clic » mène à la page de confirmation ; après confirmation, le contact apparaît « désinscrit » dans Brevo. (Refais ensuite une demande avec une autre adresse pour la suite des tests.)
- [ ] [securityheaders.com](https://securityheaders.com) sur `https://growcom.fr` : note A attendue.
- [ ] Dans Brevo, le contact apparaît dans la liste avec ses attributs (dont `UTM_SOURCE` si tu as testé avec `?utm_source=test` dans l'adresse).
- [ ] Mesure de performance réelle : [pagespeed.web.dev](https://pagespeed.web.dev) sur l'accueil et le simulateur (objectif ≥ 95 en Performance, Accessibilité, SEO ; mesurés en local à 94-98 et 100).
- [ ] Référencement : [Google Search Console](https://search.google.com/search-console) › ajouter `growcom.fr` (vérification par enregistrement DNS dans Cloudflare) › *Sitemaps* › soumettre `https://growcom.fr/sitemap-index.xml`.
- [ ] En cas de souci : Worker › *Journaux* (Observability) ; les messages commencent par `[lead]`.

---

## Mettre à jour le site ensuite

- Tout `git push` sur `main` redéploie automatiquement.
- Modèle de grille modifié (`marketing/scripts/generate-templates.ts`) : lancer `npm run generate:templates` dans `marketing`, puis, sur un PC avec Excel, `powershell -ExecutionPolicy Bypass -File scripts/verify-template.ps1` (vérifie les formules contre le moteur), et committer les fichiers de `public/modele/`.

---

## Plus tard : mettre l'app en ligne sur app.growcom.fr

À prévoir le jour où le SaaS (`/backend` + `/frontend`) sera ouvert. Aucune migration du site marketing n'est nécessaire : il reste tel quel sur `growcom.fr`.

**Architecture recommandée : l'app et son serveur sous la même adresse.** Le frontend appelle son serveur sur `/api` (même domaine) et le cookie de session est `SameSite=strict` : servir `https://app.growcom.fr` (le frontend) **et** `https://app.growcom.fr/api` (le backend) au même endroit évite tout problème de cookies et de CORS.

| Sujet | À faire |
| --- | --- |
| **Hébergement du backend** (Node + Express) | Une plateforme qui fait tourner un serveur Node en continu : Render, Railway, Fly.io, Scaleway (France)… Le frontend (fichiers statiques de `frontend/dist`) peut être servi par la même plateforme, ou par Cloudflare avec `/api/*` redirigé vers le backend. |
| **Base PostgreSQL** | Supabase est déjà utilisé en développement : créer un projet **de production séparé**, région UE. Appliquer `migration.sql` dans l'éditeur SQL Supabase, puis `npx prisma generate`. Renseigner `DATABASE_URL` / `DIRECT_URL`. |
| **DNS** | Cloudflare › `growcom.fr` › *DNS* : enregistrement `app` (CNAME vers l'hébergeur, selon ses instructions). |
| **Cookies d'authentification** | Garder le cookie `refresh_token` **sans attribut `domain`** (il reste limité à `app.growcom.fr`, jamais envoyé au site marketing) ; `secure` s'active déjà automatiquement en production (`NODE_ENV=production`). |
| **CORS** | `FRONTEND_URL=https://app.growcom.fr` (utilisé pour CORS et pour les liens des emails). Avec l'architecture recommandée, les appels sont de même origine. |
| **Emails de l'app (Brevo SMTP)** | `FRONTEND_URL` construit les liens d'invitation, de vérification et de réinitialisation : il doit valoir `https://app.growcom.fr`. `EMAIL_FROM` sur le domaine `growcom.fr`, déjà authentifié à l'étape 5.3. |
| **Autres variables du backend** | `JWT_ACCESS_SECRET` (≥ 32 caractères, nouveau pour la prod), `ENCRYPTION_KEY` (64 caractères hexadécimaux, **à conserver précieusement** : elle chiffre les clés Odoo), `ANTHROPIC_API_KEY`, `STRIPE_*`, `BREVO_SMTP_KEY`, `BREVO_SMTP_LOGIN`. Voir `backend/src/config/env.ts`. |
| **Lien depuis le site** | Dans `marketing/src/lib/site.ts`, `appUrl` pointe déjà vers `https://app.growcom.fr` : ajouter un lien « Se connecter » dans l'en-tête le jour venu. |
