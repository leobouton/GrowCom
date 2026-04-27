# GrowCom — Plateforme de transparence des commissions commerciales

GrowCom permet aux équipes commerciales de consulter, comprendre et projeter leurs commissions en temps réel. Les managers configurent les règles via une interface IA, valident et paient les commissions. Les commerciaux voient exactement d'où viennent leurs gains.

---

## Prérequis

Avant de commencer, vous avez besoin de :

- **Node.js 20+** — [Télécharger ici](https://nodejs.org/)
- **npm 10+** (inclus avec Node.js)
- Un compte **Supabase** (gratuit) — [supabase.com](https://supabase.com)
- Un compte **Anthropic** (pour l'IA) — [console.anthropic.com](https://console.anthropic.com)
- Un compte **Stripe** (pour la facturation) — [stripe.com](https://stripe.com)
- Un compte **Resend** (pour les emails) — [resend.com](https://resend.com)

---

## Installation étape par étape

### 1. Cloner / ouvrir le projet

```bash
# Le projet est déjà dans votre dossier
cd GROWCOM
```

### 2. Installer les dépendances du backend

```bash
cd backend
npm install
```

### 3. Installer les dépendances du frontend

```bash
cd ../frontend
npm install
```

### 4. Configurer les variables d'environnement du backend

```bash
cd ../backend
cp .env.example .env
```

Ouvrez le fichier `.env` et remplissez chaque valeur :

| Variable | Comment l'obtenir |
|----------|-------------------|
| `DATABASE_URL` | Supabase → Settings → Database → Connection String (mode Pooler) |
| `DIRECT_URL` | Supabase → Settings → Database → Connection String (mode Direct) |
| `JWT_ACCESS_SECRET` | Générez avec : `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Idem, générez un autre |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `STRIPE_SECRET_KEY` | [dashboard.stripe.com](https://dashboard.stripe.com/apikeys) → Clé secrète test |
| `STRIPE_WEBHOOK_SECRET` | Voir section Stripe ci-dessous |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) |

### 5. Configurer les variables d'environnement du frontend

```bash
cd ../frontend
cp .env.example .env
```

Le fichier `.env` frontend contient uniquement :
```
VITE_API_URL=http://localhost:3001
```

### 6. Créer la base de données (migrations Prisma)

```bash
cd ../backend
npm run prisma:generate
npm run prisma:migrate
```

> Prisma va créer toutes les tables automatiquement dans votre base Supabase.

### 7. Démarrer les serveurs

**Terminal 1 — Backend :**
```bash
cd backend
npm run dev
```
Le serveur démarre sur `http://localhost:3001`

**Terminal 2 — Frontend :**
```bash
cd frontend
npm run dev
```
L'interface démarre sur `http://localhost:5173`

---

## Créer le premier compte Super Admin

Pour le moment, le rôle SUPER_ADMIN doit être créé manuellement en base de données. Utilisez Prisma Studio :

```bash
cd backend
npm run prisma:studio
```

Puis créez un utilisateur avec `role: SUPER_ADMIN` et `tenantId: null`.

Alternativement, créez un compte via `/register` (qui crée un MANAGER), puis modifiez le rôle en base.

---

## Configuration Stripe Webhook (développement local)

Pour recevoir les webhooks Stripe en local, installez le CLI Stripe :

```bash
# Windows
winget install Stripe.StripeCLI

# Puis écoutez les webhooks
stripe listen --forward-to localhost:3001/api/billing/webhook
```

Le CLI vous donnera un `whsec_...` à mettre dans `STRIPE_WEBHOOK_SECRET`.

---

## Structure du projet

```
GROWCOM/
├── frontend/          # Interface React + TypeScript + Tailwind
│   └── src/
│       ├── components/    # Boutons, Cards, Modals, Layout
│       ├── pages/         # admin/, manager/, commercial/, auth/
│       ├── services/      # Appels API axios
│       ├── stores/        # Zustand (auth)
│       └── hooks/         # useAuth
├── backend/           # API Node.js + Express + Prisma
│   └── src/
│       ├── routes/        # Définition des routes
│       ├── controllers/   # Reçoit req/res
│       ├── services/      # Logique métier
│       ├── repositories/  # Accès base de données
│       ├── middlewares/   # Auth, rôles, erreurs
│       ├── integrations/  # IA, Odoo, Stripe, Email
│       └── config/        # env, prisma, logger
└── shared/            # Types TypeScript partagés
```

---

## Les 3 espaces de l'application

| Espace | URL | Rôle | Fonctionnalités |
|--------|-----|------|-----------------|
| Super Admin | `/admin` | SUPER_ADMIN | Liste des clients, MRR global |
| Manager | `/manager` | MANAGER | Dashboard, règles IA, équipe, Odoo, facturation |
| Commercial | `/dashboard` | COMMERCIAL | Mes commissions, mes projections |

---

## Commandes disponibles

### Backend
```bash
npm run dev           # Démarrer en mode développement (hot reload)
npm run build         # Compiler TypeScript
npm run start         # Démarrer en production
npm run prisma:studio # Interface visuelle de la base de données
npm run prisma:migrate # Appliquer les migrations
npm run lint          # Vérifier le code
```

### Frontend
```bash
npm run dev     # Démarrer en mode développement
npm run build   # Build de production
npm run preview # Prévisualiser le build
npm run lint    # Vérifier le code
```

---

## API Endpoints

### Auth
- `POST /api/auth/register` — Inscription manager + création tenant
- `POST /api/auth/login` — Connexion
- `POST /api/auth/logout` — Déconnexion
- `POST /api/auth/refresh` — Rafraîchir le token
- `GET /api/auth/me` — Profil utilisateur connecté
- `POST /api/auth/invite` — Inviter un commercial (manager)
- `POST /api/auth/accept-invitation` — Accepter une invitation
- `GET /api/auth/team` — Liste de l'équipe (manager)

### Commissions
- `GET /api/commissions/manager/stats` — Stats dashboard manager
- `GET /api/commissions/manager/pending` — Commissions en attente
- `PATCH /api/commissions/:id/status` — Valider ou marquer payé
- `GET /api/commissions/commercial/stats` — Stats + projections commercial

### Règles de commission
- `GET /api/commission-rules` — Liste des règles
- `GET /api/commission-rules/active` — Règle active
- `POST /api/commission-rules/generate` — Générer une règle via IA
- `POST /api/commission-rules/:id/activate` — Activer une règle

### Odoo
- `GET /api/odoo/config` — Statut de la configuration
- `POST /api/odoo/config` — Sauvegarder les credentials
- `POST /api/odoo/sync` — Lancer une synchronisation

### Facturation
- `GET /api/billing` — Informations de facturation
- `POST /api/billing/subscribe` — Créer/mettre à jour l'abonnement
- `POST /api/billing/webhook` — Webhook Stripe

### Admin
- `GET /api/admin/tenants` — Liste de tous les tenants
- `GET /api/admin/tenants/:id` — Détail d'un tenant

---

## Modèle de tarification

**10€ / utilisateur actif / mois**

Calculé automatiquement via Stripe selon le nombre d'utilisateurs actifs dans le tenant.

---

## Technologies utilisées

**Frontend** : React 18, TypeScript, Vite, Tailwind CSS, Zustand, Axios, React Hook Form, Zod

**Backend** : Node.js, Express, TypeScript, Prisma, PostgreSQL (Supabase), JWT, Bcrypt, Winston

**Services** : Anthropic Claude (IA), Stripe (paiements), Resend (emails), Odoo (CRM sync)
