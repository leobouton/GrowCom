import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { odooService } from '../integrations/odoo.service';
import { tenantRepository } from '../repositories/tenant.repository';
import { userRepository } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { decrypt } from '../utils/encryption';

const odooConfigSchema = z.object({
  odooUrl: z.string().url('URL Odoo invalide'),
  odooDatabase: z.string().min(1, 'Base de données requise'),
  odooLogin: z.string().email('Email Odoo invalide'),
  odooApiKey: z.string().min(1, 'Clé API requise'),
});

export const odooController = {
  async configure(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { odooUrl, odooDatabase, odooLogin, odooApiKey } = odooConfigSchema.parse(req.body);

      const tenant = await tenantRepository.updateOdooConfig(
        user.tenantId!,
        odooUrl,
        odooDatabase,
        odooLogin,
        odooApiKey,
      );

      res.json({
        success: true,
        data: {
          odooUrl: tenant.odooUrl,
          odooDatabase: tenant.odooDatabase,
          odooLogin: tenant.odooLogin,
          configured: true,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async sync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenant = await tenantRepository.findById(user.tenantId!);

      if (!tenant?.odooUrl || !tenant?.odooDatabase || !tenant?.odooLogin || !tenant?.odooApiKey) {
        throw new AppError(400, 'ODOO_NOT_CONFIGURED', 'Odoo n\'est pas configuré. Veuillez renseigner l\'URL, la base de données, l\'email et la clé API.');
      }

      const result = await odooService.sync(
        user.tenantId!,
        user.userId,
        tenant.odooUrl,
        tenant.odooDatabase,
        tenant.odooLogin,
        decrypt(tenant.odooApiKey), // Déchiffrement de la clé stockée chiffrée
      );

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  async getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenant = await tenantRepository.findById(user.tenantId!);

      res.json({
        success: true,
        data: {
          configured: !!(tenant?.odooUrl && tenant?.odooDatabase && tenant?.odooLogin && tenant?.odooApiKey),
          odooUrl: tenant?.odooUrl ?? null,
          odooDatabase: tenant?.odooDatabase ?? null,
          odooLogin: tenant?.odooLogin ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Diagnostic Odoo — lecture seule, rien n'est écrit en base.
   * Analyse complète de ce qui sera importé lors d'un vrai sync.
   */
  async diagnostic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const tenant = await tenantRepository.findById(user.tenantId!);

      if (!tenant?.odooUrl || !tenant?.odooDatabase || !tenant?.odooLogin || !tenant?.odooApiKey) {
        throw new AppError(400, 'ODOO_NOT_CONFIGURED', 'Odoo n\'est pas configuré. Veuillez renseigner les identifiants d\'abord.');
      }

      const apiKey = decrypt(tenant.odooApiKey);

      // ── 1. Test de connexion ────────────────────────────────────────────────
      let uid: number;
      try {
        uid = await odooService.authenticate(tenant.odooUrl, tenant.odooDatabase, tenant.odooLogin, apiKey);
      } catch (err) {
        res.json({
          success: true,
          data: {
            connexion: { ok: false, erreur: err instanceof Error ? err.message : String(err) },
          },
        });
        return;
      }

      // ── 2. Récupération des leads ───────────────────────────────────────────
      let leads: Awaited<ReturnType<typeof odooService.fetchLeads>>;
      try {
        leads = await odooService.fetchLeads(tenant.odooUrl, tenant.odooDatabase, uid, apiKey);
      } catch (err) {
        res.json({
          success: true,
          data: {
            connexion: { ok: true, uid },
            leads: { ok: false, erreur: err instanceof Error ? err.message : String(err) },
          },
        });
        return;
      }

      // ── 3. Analyse des leads ────────────────────────────────────────────────
      const tenantUsers = await userRepository.findByTenantId(user.tenantId!);
      const growcomNames = tenantUsers.map((u) => `${u.firstName} ${u.lastName}`.toLowerCase().trim());

      const statsByStatus = { WON: 0, LOST: 0, OPEN: 0 };
      const sansCommercial: string[] = [];
      const commerciauxNonMatchés: Array<{ dealNom: string; nomOdoo: string }> = [];
      const commerciauxMatchés: Array<{ dealNom: string; nomOdoo: string; utilisateurGrowCom: string }> = [];
      const sansMontant: string[] = [];
      const sansClient: string[] = [];
      const wonSansDate: string[] = [];
      const commissionsÀGénérer: Array<{ dealNom: string; montant: number; commercial: string }> = [];
      const nomsOdooUniques = new Set<string>();

      for (const lead of leads) {
        // Statut
        const stageName = Array.isArray(lead.stage_id) ? lead.stage_id[1] : '';
        const s = stageName.toLowerCase();
        let status: 'WON' | 'LOST' | 'OPEN';
        if (s.includes('gagn') || s.includes('won') || lead.probability === 100) status = 'WON';
        else if (s.includes('perdu') || s.includes('lost') || lead.probability === 0) status = 'LOST';
        else status = 'OPEN';
        statsByStatus[status]++;

        // Commercial
        if (!lead.user_id) {
          sansCommercial.push(lead.name);
        } else {
          const nomOdoo = lead.user_id[1];
          nomsOdooUniques.add(nomOdoo);
          const normalizedNom = nomOdoo.toLowerCase().replace(/\s+/g, ' ').trim();
          const matched = tenantUsers.find(
            (u) => `${u.firstName} ${u.lastName}`.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedNom,
          );
          if (matched) {
            commerciauxMatchés.push({ dealNom: lead.name, nomOdoo, utilisateurGrowCom: `${matched.firstName} ${matched.lastName}` });
            if (status === 'WON' && lead.expected_revenue > 0) {
              commissionsÀGénérer.push({ dealNom: lead.name, montant: lead.expected_revenue, commercial: matched.firstName + ' ' + matched.lastName });
            }
          } else {
            commerciauxNonMatchés.push({ dealNom: lead.name, nomOdoo });
          }
        }

        // Montant
        if (!lead.expected_revenue || lead.expected_revenue === 0) {
          sansMontant.push(lead.name);
        }

        // Client
        if (!lead.partner_id) {
          sansClient.push(lead.name);
        }

        // WON sans date de fermeture
        if (status === 'WON' && !lead.date_closed && !lead.write_date) {
          wonSansDate.push(lead.name);
        }
      }

      // ── 4. Score de santé global ────────────────────────────────────────────
      const totalLeads = leads.length;
      const matchRate = totalLeads > 0 ? Math.round(((totalLeads - sansCommercial.length - commerciauxNonMatchés.length) / totalLeads) * 100) : 100;
      const alertes: string[] = [];

      if (leads.length === 1000) alertes.push('⚠️ Limite de 1000 deals atteinte — des deals peuvent être manquants (pagination non implémentée)');
      if (commerciauxNonMatchés.length > 0) alertes.push(`⚠️ ${commerciauxNonMatchés.length} deal(s) ont un commercial Odoo qui ne correspond à aucun utilisateur GrowCom`);
      if (sansMontant.length > 0) alertes.push(`ℹ️ ${sansMontant.length} deal(s) sans montant — les commissions seront à 0€`);
      if (sansClient.length > 0) alertes.push(`ℹ️ ${sansClient.length} deal(s) sans nom de client`);
      if (wonSansDate.length > 0) alertes.push(`ℹ️ ${wonSansDate.length} deal(s) WON sans aucune date — la date de closing sera approximative`);

      res.json({
        success: true,
        data: {
          connexion: { ok: true, uid, message: 'Authentification Odoo réussie' },
          leads: {
            ok: true,
            total: totalLeads,
            limitAtteinte: totalLeads === 1000,
            parStatut: statsByStatus,
          },
          commerciaux: {
            tauxDeCorrespondance: `${matchRate}%`,
            nomsDansOdoo: Array.from(nomsOdooUniques).sort(),
            nomsDansGrowCom: growcomNames.map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase())),
            matchés: commerciauxMatchés.length,
            nonMatchés: commerciauxNonMatchés.length,
            détailNonMatchés: commerciauxNonMatchés.slice(0, 20),
            sansCommercial: sansCommercial.length,
          },
          qualitéDesDonnées: {
            sansMontant: sansMontant.length,
            sansClient: sansClient.length,
            wonSansDate: wonSansDate.length,
          },
          commissions: {
            àGénérerAuProchainSync: commissionsÀGénérer.length,
            détail: commissionsÀGénérer.slice(0, 10),
          },
          alertes,
          santéGlobale: alertes.length === 0 ? '✅ Tout est prêt pour la synchronisation' : alertes.length <= 2 ? '🟡 Quelques points à corriger avant la mise en production' : '🔴 Plusieurs problèmes détectés — à résoudre avant de livrer à un client',
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
