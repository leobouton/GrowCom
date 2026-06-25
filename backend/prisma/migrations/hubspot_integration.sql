-- ============================================================
-- Migration : Intégration HubSpot
-- À EXÉCUTER DANS SUPABASE (SQL Editor) AVANT de redémarrer le backend.
-- ============================================================

-- 1. Ajouter la valeur HUBSPOT à l'enum DealSource
ALTER TYPE "DealSource" ADD VALUE IF NOT EXISTS 'HUBSPOT';

-- 2. Champs HubSpot sur le Tenant (token chiffré + identifiant de portail)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "hubspotToken" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "hubspotPortalId" TEXT;

-- 3. Identifiant HubSpot du deal + contrainte d'unicité multi-tenant
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "hubspotId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_tenantId_hubspotId_key" ON "Deal" ("tenantId", "hubspotId");
