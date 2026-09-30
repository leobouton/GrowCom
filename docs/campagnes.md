# Suivre ses campagnes de cold emailing

Objectif : savoir **quel email a généré quel contact**. Il suffit d'ajouter quelques paramètres à la fin des liens de tes emails ; le site les transmet à Brevo avec chaque demande de document.

## 1. Construire le lien

Adresse de base (le simulateur est la meilleure page d'arrivée pour un cold email) :

```
https://growcom.fr/simulateur-commission-negociateur-immobilier
```

On ajoute `?` puis les paramètres, séparés par `&` :

```
https://growcom.fr/simulateur-commission-negociateur-immobilier?utm_source=lemlist&utm_medium=email&utm_campaign=agences-nantes-oct&utm_content=relance-1&cid={{identifiant}}
```

| Paramètre | Sert à | Exemple |
| --- | --- | --- |
| `utm_source` | l'outil d'envoi | `lemlist`, `lgm`, `brevo`, `linkedin` |
| `utm_medium` | le canal | `email` |
| `utm_campaign` | la campagne | `agences-nantes-oct` |
| `utm_content` | la variante ou l'étape | `email-1`, `relance-2`, `objet-b` |
| `utm_term` | (facultatif) un mot-clé | `paliers` |
| `cid` | **ton identifiant libre** : un numéro de prospect, de séquence… | `{{leadId}}` dans ton outil d'envoi |

Règles simples :
- en minuscules, sans espaces ni accents (`agences-nantes-oct`, pas `Agences Nantes Oct.`) ;
- **jamais d'adresse email, de nom ou de numéro de téléphone dans un lien** : `cid` doit être un identifiant neutre (le numéro que ton outil attribue au prospect), pas une donnée personnelle ;
- une campagne = un `utm_campaign` stable pendant toute sa durée.

## 2. Ce que fait le site

- Les paramètres restent dans l'adresse et **suivent le visiteur de page en page** (accueil → simulateur → modèle de grille). Rien n'est stocké dans son navigateur : pas de cookie, pas de bandeau de consentement.
- Quand il demande un document, les paramètres sont enregistrés sur le contact Brevo : attributs `UTM_SOURCE`, `UTM_MEDIUM`, `UTM_CAMPAIGN`, `UTM_CONTENT`, `UTM_TERM`, `CAMPAGNE_ID` (= `cid`), avec `SOURCE` (simulateur ou modèle), `DATE_DEMANDE`, et `RAPPEL_DEMANDE` s'il a laissé son numéro.
- Si la même personne revient plus tard par une autre campagne, ses attributs sont **mis à jour avec la dernière campagne** (« dernier contact »).
- Le bouton « Copier le lien de cette simulation » retire ces paramètres : un collègue à qui le lien est transmis n'est pas attribué à la campagne de quelqu'un d'autre.

## 3. Lire les résultats dans Brevo

- **Contacts d'une campagne** : Contacts › *Filtrer* › `UTM_CAMPAIGN` *est égal à* `agences-nantes-oct`. Enregistre le filtre comme **segment** pour le retrouver.
- **Quel email convertit le mieux** : même filtre, puis compare les nombres de contacts par `UTM_CONTENT`.
- **À rappeler en priorité** : filtre `RAPPEL_DEMANDE` *est vrai* (tu reçois aussi une alerte par email à chaque demande de rappel).
- **Retrouver un prospect précis** : filtre `CAMPAGNE_ID` *est égal à* l'identifiant de ton outil d'envoi.

## 4. Vérifier un lien avant l'envoi

Ouvre le lien dans une fenêtre de navigation privée, clique sur « Modèle de grille » dans le menu : l'adresse de la nouvelle page doit toujours contenir tes paramètres. Fais ensuite une demande de document avec ta propre adresse et vérifie les attributs du contact dans Brevo.
