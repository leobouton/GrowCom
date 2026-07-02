import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middlewares/errorHandler';
import { CommissionRuleType } from '../../../shared/types';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Schéma Zod de validation de la réponse IA
const tierSchema = z.object({
  min: z.number().min(0),
  max: z.number().positive().nullable(),
  rate: z.number().min(0).max(1),
});

const exampleSchema = z.object({
  saleAmount: z.number().positive(),
  commission: z.number().min(0),
  explanation: z.string(),
});

const commissionRuleConfigSchema = z.object({
  type: z.nativeEnum(CommissionRuleType),
  description: z.string().min(1),
  tiers: z.array(tierSchema).optional(),
  rate: z.number().min(0).max(1).optional(),
  fixedAmount: z.number().min(0).optional(),
  examples: z.array(exampleSchema).min(1),
  // Champs Session B — optionnels
  calculationBasis: z.enum(['REVENUE', 'MARGIN']).optional(),
  paymentTrigger: z.enum(['DEAL_WON', 'CLIENT_PAID']).optional(),
  cap: z.number().positive().optional(),
  floor: z.number().positive().optional(),
});

export type GeneratedRuleConfig = z.infer<typeof commissionRuleConfigSchema>;

// ─── Schéma Zod — plan multi-composants (Session F) ───────────────────────────

const planConfigSchema = z.object({
  type: z.nativeEnum(CommissionRuleType),
  description: z.string().min(1),
  tiers: z.array(tierSchema).optional(),
  rate: z.number().min(0).max(1).optional(),
  fixedAmount: z.number().min(0).optional(),
  examples: z.array(exampleSchema).min(1),
  calculationBasis: z.enum(['REVENUE', 'MARGIN', 'PER_UNIT']).optional(),
  paymentTrigger: z.enum(['DEAL_WON', 'CLIENT_PAID']).optional(),
  cap: z.number().positive().optional(),
  floor: z.number().positive().optional(),
  appliesToEventType: z.enum(['DEAL_WON', 'MISSION_MONTH']).optional(),
});

const planObjectiveSchema = z.object({
  label: z.string().min(1),
  target: z.number().positive(),
  unit: z.string().min(1),
  periodType: z.enum(['monthly', 'quarterly', 'semester', 'annual', 'custom']),
  month: z.number().int().min(1).max(12).optional(),
  quarter: z.number().int().min(1).max(4).optional(),
  semester: z.number().int().min(1).max(2).optional(),
  year: z.number().int().optional(),
  bonus: z.object({
    enabled: z.boolean(),
    type: z.enum(['percentage', 'fixed']),
    value: z.number().min(0),
  }).optional(),
  bonusMode: z.enum(['none', 'simple', 'tiered']).optional(),
  bonusTiers: z.array(z.object({
    threshold: z.number(),
    reward: z.object({ type: z.enum(['fixed', 'percentage']), value: z.number() }),
  })).optional(),
  recurrence: z.enum(['none', 'monthly', 'quarterly', 'semester', 'annual']).optional(),
});

const planComponentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('COMMISSION_RULE'),
    name: z.string().min(1),
    config: planConfigSchema,
  }),
  z.object({
    kind: z.literal('OBJECTIVE'),
    objective: planObjectiveSchema,
  }),
]);

const generatedPlanSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  components: z.array(planComponentSchema).min(1),
});

export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

const PLAN_SYSTEM_PROMPT = `Tu es un expert en rémunération variable commerciale, spécialiste des ESN (sociétés de conseil / prestation informatique).
Ton rôle : convertir la description en langage naturel d'un PLAN DE VARIABLE en une structure JSON multi-composants précise et calculable.

Un plan agrège plusieurs COMPOSANTS. Chaque composant est soit une RÈGLE DE COMMISSION, soit un OBJECTIF.

RÈGLES STRICTES :
- Réponds UNIQUEMENT avec un objet JSON valide, sans texte ni balises markdown autour
- Les taux (rate) sont des décimaux entre 0 et 1 (ex: 10% = 0.10)
- Paliers ordonnés du min au max, sans chevauchement, dernier palier max: null
- Chaque composant de commission fournit au moins 3 "examples" de calcul réels

TYPES DE COMPOSANTS DE COMMISSION (champ appliesToEventType) :
- Recrutement one-shot (deal WON) → appliesToEventType: "DEAL_WON" (défaut). Ex: prime à la signature.
- Récurrent ESN mensuel → appliesToEventType: "MISSION_MONTH". Deux modes :
  * Marge mensuelle récurrente : type "PERCENTAGE" + calculationBasis "MARGIN" (ex: 5% de la marge mensuelle de la mission).
  * Forfait fixe par consultant placé : type "FIXED" + calculationBasis "PER_UNIT" + fixedAmount = montant/mois/consultant (ex: 100€/mois/consultant). Ici les "examples" utilisent saleAmount = nombre de consultants.

DÉTECTION DES CHAMPS AVANCÉS :
- "sur la marge" → calculationBasis: "MARGIN"
- "par consultant", "par personne placée", "/mois/consultant" → calculationBasis: "PER_UNIT" + appliesToEventType: "MISSION_MONTH"
- "chaque mois", "récurrent", "tant que la mission tourne" → appliesToEventType: "MISSION_MONTH"
- "plafonné à X€" → cap: X ; "à partir de X€" → floor: X
- "quand le client paie" → paymentTrigger: "CLIENT_PAID"

OBJECTIFS (composant kind: "OBJECTIVE") :
- Champs : label, target (nombre), unit ("€" | "deals" | "marge"), periodType ("monthly"|"quarterly"|"semester"|"annual").
- Prime optionnelle : bonus { enabled, type ("percentage"|"fixed"), value } ou bonusMode "tiered" + bonusTiers.
- Récurrence optionnelle : recurrence ("monthly"|"quarterly"|"semester"|"annual").

FORMAT JSON ATTENDU :
{
  "name": "Nom du plan",
  "description": "Résumé lisible du plan",
  "components": [
    { "kind": "COMMISSION_RULE", "name": "Prime recrutement", "config": { "type": "PERCENTAGE", "description": "...", "rate": 0.05, "appliesToEventType": "DEAL_WON", "examples": [ ... ] } },
    { "kind": "COMMISSION_RULE", "name": "Récurrent marge", "config": { "type": "PERCENTAGE", "description": "...", "rate": 0.05, "calculationBasis": "MARGIN", "appliesToEventType": "MISSION_MONTH", "examples": [ ... ] } },
    { "kind": "COMMISSION_RULE", "name": "Forfait consultant", "config": { "type": "FIXED", "description": "...", "fixedAmount": 100, "calculationBasis": "PER_UNIT", "appliesToEventType": "MISSION_MONTH", "examples": [ { "saleAmount": 3, "commission": 300, "explanation": "3 consultants × 100€ = 300€" } ] } },
    { "kind": "OBJECTIVE", "objective": { "label": "CA trimestriel", "target": 150000, "unit": "€", "periodType": "quarterly", "bonus": { "enabled": true, "type": "fixed", "value": 1000 } } }
  ]
}

EXEMPLE DE CONVERSION :
Entrée : "5% sur la marge de recrutement à la signature, puis 100€ par mois et par consultant placé tant que la mission tourne, et un objectif de 150k€ de CA par trimestre avec 1000€ de prime."
Sortie :
{
  "name": "Plan variable consultant ESN",
  "description": "5% marge à la signature + 100€/mois/consultant récurrent + objectif trimestriel 150k€",
  "components": [
    { "kind": "COMMISSION_RULE", "name": "Prime signature", "config": { "type": "PERCENTAGE", "description": "5% de la marge à la signature", "rate": 0.05, "calculationBasis": "MARGIN", "appliesToEventType": "DEAL_WON", "examples": [ { "saleAmount": 10000, "commission": 500, "explanation": "Marge 10 000€ × 5% = 500€" }, { "saleAmount": 20000, "commission": 1000, "explanation": "Marge 20 000€ × 5% = 1 000€" }, { "saleAmount": 30000, "commission": 1500, "explanation": "Marge 30 000€ × 5% = 1 500€" } ] } },
    { "kind": "COMMISSION_RULE", "name": "Forfait mensuel consultant", "config": { "type": "FIXED", "description": "100€ par mois et par consultant placé", "fixedAmount": 100, "calculationBasis": "PER_UNIT", "appliesToEventType": "MISSION_MONTH", "examples": [ { "saleAmount": 1, "commission": 100, "explanation": "1 consultant × 100€ = 100€" }, { "saleAmount": 3, "commission": 300, "explanation": "3 consultants × 100€ = 300€" }, { "saleAmount": 5, "commission": 500, "explanation": "5 consultants × 100€ = 500€" } ] } },
    { "kind": "OBJECTIVE", "objective": { "label": "CA trimestriel", "target": 150000, "unit": "€", "periodType": "quarterly", "bonus": { "enabled": true, "type": "fixed", "value": 1000 } } }
  ]
}`;

const SYSTEM_PROMPT = `Tu es un expert en rémunération variable et commissions commerciales.
Ton rôle est d'analyser la description d'une règle de commission formulée en langage naturel par un manager commercial, puis de la convertir en une structure JSON précise et calculable.

RÈGLES STRICTES :
- Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour
- Ne mets pas de balises markdown (pas de \`\`\`json)
- Les taux (rate) sont des décimaux entre 0 et 1 (ex: 10% = 0.10)
- Pour les règles par paliers, les paliers ne se chevauchent pas et sont ordonnés du min au max
- Le dernier palier a max: null (infini)
- Les exemples doivent être des calculs réels basés sur les règles définies
- Fournis au moins 3 exemples représentatifs (montants typiques pour chaque palier)
- Dans les exemples, le champ "saleAmount" représente la BASE de calcul (CA ou marge selon calculationBasis)

DÉTECTION DES CHAMPS AVANCÉS (optionnels) :
- "sur la marge", "marge brute", "marge", "selon le profit" → calculationBasis: "MARGIN"
- "plafonné à X€", "max X€", "plafond X€", "pas plus de X€" → cap: X
- "à partir de X€", "minimum X€ de vente", "seuil de X€", "si deal > X€" → floor: X
- "quand le client paie", "au règlement client", "à la facturation", "après encaissement" → paymentTrigger: "CLIENT_PAID"
- Sinon (défaut) : calculationBasis: "REVENUE", paymentTrigger: "DEAL_WON" (ne pas inclure si valeur par défaut)

FORMAT JSON ATTENDU :
{
  "type": "PERCENTAGE" | "FIXED" | "TIERED",
  "description": "Description claire et lisible de la règle",
  "tiers": [{ "min": 0, "max": 10000, "rate": 0.10 }, ...],  // uniquement si TIERED
  "rate": 0.10,  // uniquement si PERCENTAGE simple
  "fixedAmount": 500,  // uniquement si FIXED
  "calculationBasis": "MARGIN",   // seulement si calcul sur marge
  "paymentTrigger": "CLIENT_PAID", // seulement si paiement déclenché au règlement client
  "cap": 5000,    // seulement si plafond explicite
  "floor": 1000,  // seulement si seuil minimum explicite
  "examples": [
    { "saleAmount": 8000, "commission": 800, "explanation": "CA 8 000€ × 10% = 800€" }
  ]
}

EXEMPLES DE CONVERSION :

Entrée : "15% sur la marge brute, plafonnée à 5000€"
Sortie :
{
  "type": "PERCENTAGE",
  "description": "15% de la marge brute du deal, plafonnée à 5 000€",
  "rate": 0.15,
  "calculationBasis": "MARGIN",
  "cap": 5000,
  "examples": [
    { "saleAmount": 10000, "commission": 1500, "explanation": "Marge 10 000€ × 15% = 1 500€" },
    { "saleAmount": 20000, "commission": 3000, "explanation": "Marge 20 000€ × 15% = 3 000€" },
    { "saleAmount": 40000, "commission": 5000, "explanation": "Marge 40 000€ × 15% = 6 000€ → plafonné à 5 000€" }
  ]
}

Entrée : "500€ fixe par deal à partir de 10 000€ de CA, versé quand le client paie"
Sortie :
{
  "type": "FIXED",
  "description": "Prime fixe de 500€ par deal ≥ 10 000€, versée au règlement client",
  "fixedAmount": 500,
  "floor": 10000,
  "paymentTrigger": "CLIENT_PAID",
  "examples": [
    { "saleAmount": 10000, "commission": 500, "explanation": "Deal ≥ 10 000€ → prime fixe 500€" },
    { "saleAmount": 25000, "commission": 500, "explanation": "Deal ≥ 10 000€ → prime fixe 500€" },
    { "saleAmount": 9500, "commission": 0, "explanation": "Deal < 10 000€ → sous le seuil, pas de prime" }
  ]
}

Entrée : "10% jusqu'à 10 000€, 12% au-delà"
Sortie :
{
  "type": "TIERED",
  "description": "10% jusqu'à 10 000€ de CA, 12% au-delà",
  "tiers": [
    { "min": 0, "max": 10000, "rate": 0.10 },
    { "min": 10000, "max": null, "rate": 0.12 }
  ],
  "examples": [
    { "saleAmount": 5000, "commission": 500, "explanation": "5 000€ × 10% = 500€" },
    { "saleAmount": 10000, "commission": 1000, "explanation": "10 000€ × 10% = 1 000€" },
    { "saleAmount": 15000, "commission": 1600, "explanation": "CA 15 000€ par paliers : 10 000€ × 10% = 1 000€ + 5 000€ × 12% = 600€ = 1 600€" }
  ]
}`;

export const commissionAIService = {
  async generateRule(naturalLanguageDescription: string): Promise<GeneratedRuleConfig> {
    logger.info('Génération de règle de commission via IA', {
      description: naturalLanguageDescription.substring(0, 100),
    });

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }, // Cache le prompt système (~90% d'économie sur les appels répétés)
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Voici la règle de commission à convertir en JSON :\n\n"${naturalLanguageDescription}"`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new AppError(500, 'AI_INVALID_RESPONSE', 'Réponse IA invalide');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content.text.trim());
      } catch {
        logger.error('Impossible de parser la réponse JSON de l\'IA', { raw: content.text });
        throw new AppError(500, 'AI_PARSE_ERROR', 'Impossible d\'interpréter la réponse de l\'IA');
      }

      const validated = commissionRuleConfigSchema.safeParse(parsed);
      if (!validated.success) {
        logger.error('Schema de règle IA invalide', { errors: validated.error.flatten() });
        throw new AppError(
          500,
          'AI_SCHEMA_INVALID',
          'La règle générée par l\'IA n\'est pas valide',
          validated.error.flatten().fieldErrors,
        );
      }

      logger.info('Règle de commission générée avec succès', { type: validated.data.type });
      return validated.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Erreur lors de l\'appel à l\'API Anthropic', { error: err });
      throw new AppError(502, 'AI_SERVICE_ERROR', 'Le service d\'IA est temporairement indisponible');
    }
  },

  /**
   * Génère un PLAN DE VARIABLE multi-composants (commissions one-shot + récurrent ESN
   * + objectifs) à partir d'une description en langage naturel. Sortie JSON stricte
   * validée par Zod, prête à alimenter le futur wizard de saisie unifiée (champ examples conservé).
   */
  async generatePlan(naturalLanguageDescription: string): Promise<GeneratedPlan> {
    logger.info('Génération de plan de variable via IA', {
      description: naturalLanguageDescription.substring(0, 100),
    });

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: PLAN_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Voici le plan de variable à convertir en JSON :\n\n"${naturalLanguageDescription}"`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new AppError(500, 'AI_INVALID_RESPONSE', 'Réponse IA invalide');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content.text.trim());
      } catch {
        logger.error('Impossible de parser la réponse JSON de l\'IA (plan)', { raw: content.text });
        throw new AppError(500, 'AI_PARSE_ERROR', 'Impossible d\'interpréter la réponse de l\'IA');
      }

      const validated = generatedPlanSchema.safeParse(parsed);
      if (!validated.success) {
        logger.error('Schéma de plan IA invalide', { errors: validated.error.flatten() });
        throw new AppError(
          500,
          'AI_SCHEMA_INVALID',
          'Le plan généré par l\'IA n\'est pas valide',
          validated.error.flatten().fieldErrors,
        );
      }

      logger.info('Plan de variable généré avec succès', {
        components: validated.data.components.length,
      });
      return validated.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Erreur lors de l\'appel à l\'API Anthropic (plan)', { error: err });
      throw new AppError(502, 'AI_SERVICE_ERROR', 'Le service d\'IA est temporairement indisponible');
    }
  },
};
