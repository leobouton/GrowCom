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

FORMAT JSON ATTENDU :
{
  "type": "PERCENTAGE" | "FIXED" | "TIERED",
  "description": "Description claire et lisible de la règle",
  "tiers": [{ "min": 0, "max": 10000, "rate": 0.10 }, ...],  // uniquement si TIERED
  "rate": 0.10,  // uniquement si PERCENTAGE simple
  "fixedAmount": 500,  // uniquement si FIXED
  "examples": [
    { "saleAmount": 8000, "commission": 800, "explanation": "8 000€ × 10% = 800€" }
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
