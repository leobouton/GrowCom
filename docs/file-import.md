# Import fichier Excel / CSV — GrowCom

## Présentation

Cette fonctionnalité permet d'importer des deals gagnés depuis n'importe quel CRM ou tableur (Bullhorn, BoondManager, HubSpot, Pipedrive, Salesforce, Excel…) en exportant les données dans un fichier CSV ou Excel et en les important dans GrowCom.

Le moteur de commissions est déclenché automatiquement pour chaque deal importé dont le commercial est reconnu.

---

## Format attendu

### Extensions acceptées

| Extension | Description |
|-----------|-------------|
| `.csv` | Valeurs séparées par `;` ou `,` (auto-détection) |
| `.xlsx` | Excel 2007+ |
| `.xls` | Excel 97-2003 |

**Taille max : 10 MB**

### Colonnes obligatoires

| Colonne | Type | Exemple | Description |
|---------|------|---------|-------------|
| `external_id` | string | `DEAL-001` | Identifiant unique du deal dans votre CRM source |
| `deal_name` | string | `Mission développement ABC` | Nom du deal |
| `amount` | number | `15000` | Montant HT en devise indiquée |
| `currency` | string (ISO 3 lettres) | `EUR` | Code devise — défaut : EUR |
| `closed_at` | date ISO 8601 | `2024-01-15` ou `2024-01-15T10:00:00Z` | Date de signature / clôture |
| `commercial_email` | email | `jean.dupont@monentreprise.com` | Email du commercial GrowCom qui touche la commission |

### Colonnes optionnelles

| Colonne | Type | Description |
|---------|------|-------------|
| `client_name` | string | Nom du client final |
| `deal_type` | string | Type de deal (libre, utilisé pour les règles conditionnelles) |
| `notes` | string | Notes libres sur le deal |

### Devises supportées

`EUR`, `USD`, `GBP`, `CHF`, `CAD`, `AUD`, `JPY`

---

## Workflow d'import

```
1. Upload fichier  →  Parsing + Validation Zod ligne par ligne
2. Prévisualisation  →  Récap erreurs, doublons, commerciaux non reconnus
3. Confirmation  →  Création des deals + calcul des commissions
```

### Étape 1 — Upload

`POST /api/sync/upload`  
Champ form-data : `file` (multipart/form-data)

Retourne un `ImportPreview` avec :
- Nombre de lignes valides / en erreur
- Doublons détectés (external_id déjà importé)
- Emails commerciaux non reconnus
- Aperçu des 5 premières lignes valides
- `importLogId` à passer à l'étape suivante

### Étape 2 — Confirmation

`POST /api/sync/confirm`  
Body : `{ "importLogId": "..." }`

Retourne :
- `created` : nombre de deals créés
- `skipped` : doublons ignorés
- `errors` : lignes en erreur à la confirmation

### Historique

`GET /api/sync/history`  
Retourne les 5 derniers imports terminés.

---

## Gestion des erreurs

| Erreur | Comportement |
|--------|-------------|
| Colonne obligatoire manquante | Ligne bloquée — détail affiché dans la prévisualisation |
| Montant négatif | Ligne bloquée |
| Date au mauvais format | Ligne bloquée — utiliser ISO 8601 (ex: `2024-01-15`) |
| Devise non supportée | Ligne bloquée — liste des devises acceptées dans le message |
| Email commercial non reconnu | Ligne importée mais **non commissionnée** tant que l'email n'est pas associé à un collaborateur GrowCom |
| `external_id` déjà existant | Deal **ignoré** (skip + log) — ne pas écraser silencieusement |
| Fichier > 10 MB | Rejet immédiat |

---

## Règles RGPD

- Le fichier brut **n'est jamais stocké** sur disque ni en base de données.
- Seules les données extraites (champs normalisés) sont persistées dans le modèle `Deal`.
- Les lignes validées sont temporairement stockées dans `ImportLog.pendingRows` jusqu'à la confirmation, puis **supprimées** après.

---

## Déduplication

La déduplication se base sur le couple `(tenantId, external_id)`.  
Si un deal avec le même `external_id` existe déjà pour la même organisation, la ligne est ignorée avec un log — **aucun écrasement silencieux**.

---

## Architecture technique

```
fileImport.routes.ts          →  /api/sync/upload | /confirm | /history
fileImport.controller.ts      →  Orchestration, gestion erreurs HTTP
fileImport.service.ts         →  parseBuffer() + validateRows() + previewImport() + confirmImport()
importLog.repository.ts       →  CRUD ImportLog
deal.repository.ts            →  createFromFileImport() + findByFileExternalId()
commission.service.ts         →  recalculateForDeal() (hook existant, non modifié)
```

Le connecteur implémente le même pattern que le connecteur Odoo :
- Parsing → validation → upsert deals → `commissionService.recalculateForDeal()`

---

## Template CSV

Téléchargeable directement depuis la page "Connexion CRM" de l'interface GrowCom.

Format : CSV UTF-8 avec BOM, séparateur `;`

```csv
external_id;deal_name;amount;currency;closed_at;commercial_email;client_name;deal_type;notes
DEAL-001;Mission développement client ABC;15000;EUR;2024-01-15;jean.dupont@monentreprise.com;Société ABC;recrutement;Mission 6 mois
```
