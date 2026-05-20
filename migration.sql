-- ============================================================
-- GROWCOM — Migration complète (idempotente)
-- Copier-coller dans Supabase > SQL Editor > Run
-- Peut être exécutée plusieurs fois sans erreur
-- ============================================================

-- Alerte limite Odoo : date du dernier email envoyé (throttle 2 jours)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "odooLimitWarningSentAt" TIMESTAMP(3);

-- Commissions différées : délai de paiement configurable par règle
ALTER TABLE "CommissionRule" ADD COLUMN IF NOT EXISTS "paymentDelayDays" INTEGER;

-- Commissions différées : date prévue de versement calculée automatiquement
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "scheduledPaymentAt" TIMESTAMP(3);


-- 1. Groupes d'équipe

CREATE TABLE IF NOT EXISTS "Group" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "color"     TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Group_tenantId_idx" ON "Group"("tenantId");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Group_tenantId_fkey'
    ) THEN
        ALTER TABLE "Group"
            ADD CONSTRAINT "Group_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "groupId" TEXT;

CREATE INDEX IF NOT EXISTS "User_groupId_idx" ON "User"("groupId");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'User_groupId_fkey'
    ) THEN
        ALTER TABLE "User"
            ADD CONSTRAINT "User_groupId_fkey"
            FOREIGN KEY ("groupId") REFERENCES "Group"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;


-- 2. Réinitialisation du mot de passe

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_resetToken_key" ON "User"("resetToken");


-- 3. Salaire fixe par collaborateur

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fixedSalary" DOUBLE PRECISION NOT NULL DEFAULT 0;


-- 4. Rôles supplémentaires

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TEAM_LEAD';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'BU_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RECRUITER';


-- 5. Responsable d'équipe sur les groupes

ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "leadId" TEXT;

CREATE INDEX IF NOT EXISTS "Group_leadId_idx" ON "Group"("leadId");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Group_leadId_fkey'
    ) THEN
        ALTER TABLE "Group"
            ADD CONSTRAINT "Group_leadId_fkey"
            FOREIGN KEY ("leadId") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;


-- 6. Objectifs par commercial (tableau JSON)

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "objectives" JSONB NOT NULL DEFAULT '[]'::jsonb;


-- 7. Bibliothèque de règles + assignations flexibles

-- 7a. Nouveaux enums
DO $$ BEGIN
    CREATE TYPE "RuleScope" AS ENUM ('INDIVIDUAL', 'TEAM', 'GLOBAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "AssigneeType" AS ENUM ('INDIVIDUAL', 'TEAM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7b. Nouveaux champs sur CommissionRule
ALTER TABLE "CommissionRule" ADD COLUMN IF NOT EXISTS "scope"      "RuleScope" NOT NULL DEFAULT 'GLOBAL';
ALTER TABLE "CommissionRule" ADD COLUMN IF NOT EXISTS "dealType"   TEXT;
ALTER TABLE "CommissionRule" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- Mettre toutes les règles existantes comme actives dans la bibliothèque
UPDATE "CommissionRule" SET "isActive" = true WHERE "isActive" = false;

CREATE INDEX IF NOT EXISTS "CommissionRule_tenantId_isArchived_idx" ON "CommissionRule"("tenantId", "isArchived");

-- 7c. Nouvelle table RuleAssignment
CREATE TABLE IF NOT EXISTS "RuleAssignment" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "ruleId"         TEXT NOT NULL,
    "assignedToType" "AssigneeType" NOT NULL,
    "userId"         TEXT,
    "teamName"       TEXT,
    "startDate"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate"        TIMESTAMP(3),
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RuleAssignment_tenantId_idx" ON "RuleAssignment"("tenantId");
CREATE INDEX IF NOT EXISTS "RuleAssignment_userId_idx"   ON "RuleAssignment"("userId");
CREATE INDEX IF NOT EXISTS "RuleAssignment_ruleId_idx"   ON "RuleAssignment"("ruleId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RuleAssignment_tenantId_fkey') THEN
        ALTER TABLE "RuleAssignment"
            ADD CONSTRAINT "RuleAssignment_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RuleAssignment_ruleId_fkey') THEN
        ALTER TABLE "RuleAssignment"
            ADD CONSTRAINT "RuleAssignment_ruleId_fkey"
            FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RuleAssignment_userId_fkey') THEN
        ALTER TABLE "RuleAssignment"
            ADD CONSTRAINT "RuleAssignment_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 7d. Fix contrainte unique sur Commission : dealId+userId → dealId+userId+ruleId
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Commission_dealId_userId_key') THEN
        ALTER TABLE "Commission" DROP CONSTRAINT "Commission_dealId_userId_key";
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Commission_dealId_userId_ruleId_key') THEN
        ALTER TABLE "Commission"
            ADD CONSTRAINT "Commission_dealId_userId_ruleId_key"
            UNIQUE ("dealId", "userId", "ruleId");
    END IF;
END $$;


-- 8. Login Odoo sur le tenant

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "odooLogin" TEXT;


-- 9. Concours (Contests)

DO $$ BEGIN
    CREATE TYPE "ContestMetric" AS ENUM ('REVENUE', 'DEAL_COUNT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "ContestStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Contest" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "description"    TEXT NOT NULL DEFAULT '',
    "prize"          TEXT NOT NULL,
    "metric"         "ContestMetric" NOT NULL,
    "scope"          "RuleScope" NOT NULL DEFAULT 'GLOBAL',
    "teamName"       TEXT,
    "participantIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "periodStart"    TIMESTAMP(3) NOT NULL,
    "periodEnd"      TIMESTAMP(3) NOT NULL,
    "status"         "ContestStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy"      TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Contest_tenantId_idx"        ON "Contest"("tenantId");
CREATE INDEX IF NOT EXISTS "Contest_tenantId_status_idx" ON "Contest"("tenantId", "status");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Contest_tenantId_fkey') THEN
        ALTER TABLE "Contest"
            ADD CONSTRAINT "Contest_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Contest_createdBy_fkey') THEN
        ALTER TABLE "Contest"
            ADD CONSTRAINT "Contest_createdBy_fkey"
            FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Colonnes ajoutées après création initiale de Contest
ALTER TABLE "Contest" ADD COLUMN IF NOT EXISTS "scope" "RuleScope" NOT NULL DEFAULT 'GLOBAL';
ALTER TABLE "Contest" ADD COLUMN IF NOT EXISTS "teamName" TEXT;
ALTER TABLE "Contest" ADD COLUMN IF NOT EXISTS "participantIds" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Contest" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';


-- 10. Détail du calcul de commission

ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "calculationDetail" TEXT;


-- 11. Manager de région sur les groupes

ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "managerId" TEXT;

CREATE INDEX IF NOT EXISTS "Group_managerId_idx" ON "Group"("managerId");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Group_managerId_fkey'
    ) THEN
        ALTER TABLE "Group"
            ADD CONSTRAINT "Group_managerId_fkey"
            FOREIGN KEY ("managerId") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;


-- ============================================================
-- SÉCURITÉ — Row Level Security (RLS)
-- ============================================================
-- Le backend (Prisma) se connecte en tant que "postgres" (owner)
-- et contourne naturellement le RLS → aucun impact sur le fonctionnement.
-- Le RLS bloque uniquement les accès directs via l'API REST Supabase
-- (rôles "anon" et "authenticated") qui sont non autorisés.
-- ============================================================

-- 9. Activation du RLS sur toutes les tables

ALTER TABLE "Tenant"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Group"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RuleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Commission"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contest"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"       ENABLE ROW LEVEL SECURITY;

-- 10. Suppression de tout accès API REST public (anon + authenticated)
-- Aucune donnée n'est accessible via l'URL Supabase sans passer par le backend.

REVOKE ALL PRIVILEGES ON TABLE "Tenant"         FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "Group"          FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "User"           FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "RefreshToken"   FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "CommissionRule" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "RuleAssignment" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "Deal"           FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "Commission"     FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "Contest"        FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "AuditLog"       FROM anon, authenticated;

-- 11. Révocation des accès sur les séquences (clés auto-incrémentées)

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 12. Aucune politique permissive définie → deny-by-default
-- Le backend passe par le rôle "postgres" (owner) qui n'est pas soumis au RLS.
-- Si un jour une route Supabase native est nécessaire, des policies explicites
-- devront être créées ici (ex: JWT claims, tenantId matching, etc.).


-- 13. Fix Deal.odooId : unique global → unique par tenant

-- Supprime l'ancien index unique global (bloquait les clients ayant les mêmes IDs Odoo)
DROP INDEX IF EXISTS "Deal_odooId_key";

-- Crée le nouvel index unique composite (tenantId, odooId)
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_tenantId_odooId_key" ON "Deal"("tenantId", "odooId");


-- 14. Nom du client sur les deals (importé depuis Odoo)

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "clientName" TEXT;


-- ============================================================
-- 15. Import fichier — Extension du modèle Deal + ImportLog
-- ============================================================

-- 15a. Enums source et statut d'import

DO $$ BEGIN
    CREATE TYPE "DealSource" AS ENUM ('ODOO', 'FILE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'PARTIAL_ERROR', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 15b. Rendre odooId nullable (les deals importés via fichier n'ont pas d'ID Odoo)
-- Les deals existants gardent leur odooId — aucune donnée perdue
ALTER TABLE "Deal" ALTER COLUMN "odooId" DROP NOT NULL;

-- 15c. Nouveaux champs sur Deal (source de données + champs pivot)
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "source"         "DealSource" NOT NULL DEFAULT 'ODOO';
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "fileExternalId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "currency"       TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "dealType"       TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "notes"          TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "importLogId"    TEXT;

-- 15d. Index unique pour les deals importés via fichier (déduplication sur external_id)
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_tenantId_fileExternalId_key"
    ON "Deal"("tenantId", "fileExternalId");

CREATE INDEX IF NOT EXISTS "Deal_importLogId_idx" ON "Deal"("importLogId");

-- 15e. Table ImportLog
CREATE TABLE IF NOT EXISTS "ImportLog" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "uploadedBy"  TEXT NOT NULL,
    "fileName"    TEXT NOT NULL,
    "status"      "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows"   INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows"   INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errors"      JSONB NOT NULL DEFAULT '[]'::jsonb,
    "pendingRows" JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ImportLog_tenantId_idx"           ON "ImportLog"("tenantId");
CREATE INDEX IF NOT EXISTS "ImportLog_tenantId_createdAt_idx" ON "ImportLog"("tenantId", "createdAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImportLog_tenantId_fkey') THEN
        ALTER TABLE "ImportLog"
            ADD CONSTRAINT "ImportLog_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImportLog_uploadedBy_fkey') THEN
        ALTER TABLE "ImportLog"
            ADD CONSTRAINT "ImportLog_uploadedBy_fkey"
            FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_importLogId_fkey') THEN
        ALTER TABLE "Deal"
            ADD CONSTRAINT "Deal_importLogId_fkey"
            FOREIGN KEY ("importLogId") REFERENCES "ImportLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 15f. RLS sur ImportLog
ALTER TABLE "ImportLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ImportLog" FROM anon, authenticated;


-- ============================================================
-- SESSION A — Fondations data
-- ============================================================

-- 16. Marge sur les Deals

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "costAmount"   DOUBLE PRECISION;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "marginAmount" DOUBLE PRECISION;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "marginSource" TEXT;


-- 17. Statut CANCELLED sur Commission

ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "cancelledAt"        TIMESTAMP(3);
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "cancelledBy"        TEXT;
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;


-- 18. DealAssignment — Split de commission sur N commerciaux

CREATE TABLE IF NOT EXISTS "DealAssignment" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "dealId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "share"     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "role"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealAssignment_dealId_userId_key"
    ON "DealAssignment"("dealId", "userId");

CREATE INDEX IF NOT EXISTS "DealAssignment_tenantId_idx" ON "DealAssignment"("tenantId");
CREATE INDEX IF NOT EXISTS "DealAssignment_dealId_idx"   ON "DealAssignment"("dealId");
CREATE INDEX IF NOT EXISTS "DealAssignment_userId_idx"   ON "DealAssignment"("userId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DealAssignment_tenantId_fkey') THEN
        ALTER TABLE "DealAssignment"
            ADD CONSTRAINT "DealAssignment_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DealAssignment_dealId_fkey') THEN
        ALTER TABLE "DealAssignment"
            ADD CONSTRAINT "DealAssignment_dealId_fkey"
            FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DealAssignment_userId_fkey') THEN
        ALTER TABLE "DealAssignment"
            ADD CONSTRAINT "DealAssignment_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 18b. Migration données existantes : chaque deal avec assignedToId → DealAssignment share=1.0
INSERT INTO "DealAssignment" ("id", "tenantId", "dealId", "userId", "share", "createdAt")
SELECT
    gen_random_uuid()::text,
    d."tenantId",
    d."id",
    d."assignedToId",
    1.0,
    NOW()
FROM "Deal" d
WHERE d."assignedToId" IS NOT NULL
ON CONFLICT ("dealId", "userId") DO NOTHING;

-- 18c. RLS sur DealAssignment
ALTER TABLE "DealAssignment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "DealAssignment" FROM anon, authenticated;

-- ============================================================
-- SESSION B — Chantier 4 : Mode "paiement client" sur Commission
-- ============================================================

ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "awaitingClientPayment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "clientPaidAt"          TIMESTAMP(3);
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "clientPaidBy"          TEXT;

-- ============================================================
-- SESSION B — Chantier 7 : Snapshot historique des objectifs
-- ============================================================

CREATE TABLE IF NOT EXISTS "ObjectiveSnapshot" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "objectiveId"  TEXT NOT NULL,
    "periodLabel"  TEXT NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "actualValue"  DOUBLE PRECISION NOT NULL,
    "bonusEarned"  DOUBLE PRECISION NOT NULL,
    "snapshotAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObjectiveSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ObjectiveSnapshot_tenantId_idx"        ON "ObjectiveSnapshot"("tenantId");
CREATE INDEX IF NOT EXISTS "ObjectiveSnapshot_userId_idx"           ON "ObjectiveSnapshot"("userId");
CREATE INDEX IF NOT EXISTS "ObjectiveSnapshot_userId_snapshotAt_idx" ON "ObjectiveSnapshot"("userId", "snapshotAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObjectiveSnapshot_tenantId_fkey') THEN
        ALTER TABLE "ObjectiveSnapshot"
            ADD CONSTRAINT "ObjectiveSnapshot_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObjectiveSnapshot_userId_fkey') THEN
        ALTER TABLE "ObjectiveSnapshot"
            ADD CONSTRAINT "ObjectiveSnapshot_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "ObjectiveSnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "ObjectiveSnapshot" FROM anon, authenticated;