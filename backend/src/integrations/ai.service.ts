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
};
