# RGPD — registre des traitements du site growcom.fr

Ce document est le **registre des traitements** du site marketing (article 30 du RGPD), et la liste de ce qui reste à faire de ton côté. Il décrit ce que fait réellement le code ; la page publique correspondante est la [politique de confidentialité](../marketing/src/pages/politique-de-confidentialite.astro).

> À mettre à jour à chaque nouveau traitement (nouveau formulaire, nouvel outil, nouvel usage des données).
> L'app (app.growcom.fr) aura son propre registre : elle traite les données des clients et de leurs négociateurs.

**Responsable du traitement** : Léo BOUTON, à titre personnel (GrowCom est en cours de création) — _adresse à compléter_. À la création de la société : la désigner comme responsable, lui transférer les contacts, mettre à jour ce registre et les pages légales.
**Contact pour les droits** : l'adresse de contact de `marketing/src/lib/site.ts` (actuellement `leo.bouton@growcom.fr`).

---

## Traitement 1 — Demandes de documents (simulateur et modèle de grille)

| Rubrique | Contenu |
| --- | --- |
| Finalités | Envoyer le document demandé ; rappeler la personne si elle a laissé son numéro ; lui envoyer ponctuellement des informations sur GrowCom |
| Personnes concernées | Professionnels de l'immobilier (directeurs d'agence, négociateurs) |
| Données | Email (obligatoire) ; prénom, agence, ville, téléphone (facultatifs) ; page d'origine, date, paramètres de campagne (UTM), lien vers la simulation |
| Bases légales | Document et rappel : demande de la personne (mesures précontractuelles, art. 6.1.b). Informations sur GrowCom : **intérêt légitime** (art. 6.1.f), prospection entre professionnels en lien avec leur activité, avec information au moment de la collecte et opposition en un clic dans chaque email |
| Décision prise | Pas de case à cocher : email obligatoire pour recevoir le document, téléphone facultatif valant demande de rappel (décision du 29/09/2026) |
| Durée de conservation | 3 ans après le dernier contact de la personne ; après désinscription, email conservé uniquement en liste d'opposition |
| Destinataires | Équipe GrowCom ; sous-traitants ci-dessous |
| Sous-traitants | Brevo (Sendinblue SAS, France, hébergement UE) ; Cloudflare, Inc. (États-Unis) pour l'hébergement du formulaire |
| Transferts hors UE | Cloudflare : Data Privacy Framework UE–États-Unis, et à défaut clauses contractuelles types |
| Sécurité | Clé Brevo uniquement côté serveur ; envoi en POST (jamais dans l'URL) ; même origine exigée ; limitation des envois ; champ piège et Turnstile ; validation stricte ; aucune donnée personnelle dans les journaux ; HTTPS et en-têtes de sécurité |

## Traitement 2 — Mesure d'audience

| Rubrique | Contenu |
| --- | --- |
| Finalité | Statistiques globales de fréquentation (pages vues, provenance, appareils) |
| Outil | Cloudflare Web Analytics : **ni cookie, ni stockage dans le navigateur** |
| Base légale | Intérêt légitime ; aucun traceur déposé, donc pas de consentement à recueillir (article 82 de la loi Informatique et Libertés non applicable) |
| Durée | Selon Cloudflare (statistiques agrégées) |

## Traitement 3 — Sécurité du site

| Rubrique | Contenu |
| --- | --- |
| Finalité | Acheminer les pages, protéger le site et le formulaire contre les abus |
| Données | Adresse IP, navigateur, signaux techniques de session (Turnstile) |
| Base légale | Intérêt légitime (sécurité) ; le cookie technique éventuel de Turnstile (1 h) est strictement nécessaire, exempté de consentement |
| Durée | Quelques jours (journaux Cloudflare) |

## Pourquoi il n'y a pas de bandeau cookies

Le site ne dépose aucun cookie publicitaire ni de mesure d'audience et n'écrit rien dans le stockage du navigateur pour suivre les visiteurs. Le simulateur calcule tout dans le navigateur et garde ses paramètres dans l'adresse de la page, que la personne choisit de partager ou non. **Si un jour tu ajoutes un outil qui dépose des cookies** (pixel LinkedIn, Google Analytics, chat…), il faudra un bandeau de consentement où refuser est aussi simple qu'accepter.

---

## Ce qu'il te reste à faire

- [ ] Compléter l'adresse et le téléphone de l'éditeur dans les [mentions légales](../marketing/src/pages/mentions-legales.astro) et l'adresse dans la [politique de confidentialité](../marketing/src/pages/politique-de-confidentialite.astro) (chercher « À compléter »).
- [ ] Créer la boîte `leo.bouton@growcom.fr` (voir `docs/deploiement.md`, étape 5.4) : c'est là qu'arrivent les demandes d'exercice des droits (réponse sous un mois).
- [ ] **Accords de sous-traitance (DPA)** : Brevo et Cloudflare les intègrent à leurs conditions ; les accepter dans chaque compte (Brevo › Paramètres › Sécurité / RGPD ; Cloudflare : [DPA](https://www.cloudflare.com/cloudflare-customer-dpa/)) et en garder une copie.
- [ ] **Campagnes de prospection** : toujours les envoyer depuis Brevo (le lien de désinscription y est ajouté automatiquement), uniquement à des contacts dont l'activité est liée à l'immobilier, et **jamais** aux contacts désinscrits (Brevo les exclut d'office).
- [ ] **Purge annuelle** : une fois par an, dans Brevo, créer un segment « `DATE_DEMANDE` antérieure à 3 ans et aucune activité depuis » et supprimer ces contacts.
- [ ] Définir le secret `UNSUBSCRIBE_SECRET` dans Cloudflare (voir `docs/deploiement.md`, étape 4).

## Le lien de désinscription, techniquement

- Chaque email contient un lien personnel vers `growcom.fr/desinscription`. Le jeton du lien est **chiffré** (l'adresse n'y apparaît pas) et placé après « # » : il n'est jamais envoyé ni enregistré par un serveur.
- La page demande une confirmation (un clic) : les antivirus des messageries ouvrent automatiquement les liens, ils ne peuvent donc pas désinscrire quelqu'un par erreur.
- Les emails portent aussi les en-têtes `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) : Gmail, Outlook, Yahoo… affichent leur propre bouton « Se désabonner ».
- La désinscription marque le contact « ne plus recevoir d'emails » dans Brevo (liste d'opposition).
