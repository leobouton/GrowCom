-- ============================================================================
-- Migration RLS — Isolation tenant en défense-en-profondeur
-- ============================================================================
-- ATTENTION : ne pas exécuter en production sans validation préalable.
-- Pré-requis : le rôle utilisé par Prisma (ex: postgres / service_role) doit
--              être EXCLU de la RLS via FORCE ROW LEVEL SECURITY ou un BYPASSRLS.
--
-- Stratégie : chaque requête HTTP injecte `SET LOCAL app.current_tenant = '<uuid>'`
-- en début de transaction. La policy vérifie que tenant_id correspond.
-- ============================================================================

-- ─── Tables avec tenantId NOT NULL ──────────────────────────────────────────

-- Note : les noms de tables Prisma correspondent aux noms PostgreSQL générés
-- (convention par défaut : PascalCase → "PascalCase" avec guillemets)

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Group',
      'CommissionRule',
      'RuleAssignment',
      'Deal',
      'Commission',
      'DealAssignment',
      'Contest',
      'ImportLog',
      'ImportBatch',
      'AuditLog',
      'ObjectiveSnapshot',
      'CommissionAdjustment',
      'CommissionDispute'
    ])
  LOOP
    -- Activer RLS sur la table
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Policy SELECT : le tenant courant ne voit que ses propres lignes
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING ("tenantId" = current_setting(''app.current_tenant'')::uuid)',
      tbl
    );

    -- Policy INSERT : on ne peut insérer que pour son propre tenant
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK ("tenantId" = current_setting(''app.current_tenant'')::uuid)',
      tbl
    );

    -- Policy UPDATE : on ne peut modifier que les lignes de son tenant
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING ("tenantId" = current_setting(''app.current_tenant'')::uuid)',
      tbl
    );

    -- Policy DELETE : on ne peut supprimer que les lignes de son tenant
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING ("tenantId" = current_setting(''app.current_tenant'')::uuid)',
      tbl
    );
  END LOOP;
END
$$;

-- ─── Table User (tenantId nullable — SUPER_ADMIN) ──────────────────────────

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

-- Les utilisateurs avec tenantId sont visibles par leur tenant.
-- Les SUPER_ADMIN (tenantId IS NULL) sont visibles uniquement quand
-- app.current_tenant n'est pas défini (mode admin / jobs).
CREATE POLICY tenant_isolation_select ON "User"
  FOR SELECT
  USING (
    "tenantId" = current_setting('app.current_tenant', true)::uuid
    OR (
      "tenantId" IS NULL
      AND current_setting('app.current_tenant', true) IS NULL
    )
  );

CREATE POLICY tenant_isolation_insert ON "User"
  FOR INSERT
  WITH CHECK (
    "tenantId" = current_setting('app.current_tenant', true)::uuid
    OR "tenantId" IS NULL
  );

CREATE POLICY tenant_isolation_update ON "User"
  FOR UPDATE
  USING (
    "tenantId" = current_setting('app.current_tenant', true)::uuid
    OR (
      "tenantId" IS NULL
      AND current_setting('app.current_tenant', true) IS NULL
    )
  );

CREATE POLICY tenant_isolation_delete ON "User"
  FOR DELETE
  USING (
    "tenantId" = current_setting('app.current_tenant', true)::uuid
    OR (
      "tenantId" IS NULL
      AND current_setting('app.current_tenant', true) IS NULL
    )
  );

-- ─── Table Tenant (pas de RLS — accessible à tous) ─────────────────────────
-- Pas de RLS sur Tenant : chaque utilisateur doit pouvoir lire son propre tenant.

-- ─── Table RefreshToken (pas de tenantId) ───────────────────────────────────
-- Pas de RLS : les refresh tokens sont identifiés par un hash opaque, pas par tenant.
-- L'isolation est assurée par le fait que chaque token est lié à un userId spécifique.

-- ============================================================================
-- ROLLBACK (en cas de besoin) :
-- ============================================================================
-- DO $$
-- DECLARE
--   tbl TEXT;
-- BEGIN
--   FOR tbl IN
--     SELECT unnest(ARRAY[
--       'Group','CommissionRule','RuleAssignment','Deal','Commission',
--       'DealAssignment','Contest','ImportLog','ImportBatch','AuditLog',
--       'ObjectiveSnapshot','CommissionAdjustment','CommissionDispute','User'
--     ])
--   LOOP
--     EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
--     EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', tbl);
--     EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I', tbl);
--     EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %I', tbl);
--     EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %I', tbl);
--   END LOOP;
-- END
-- $$;
