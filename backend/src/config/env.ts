import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Serveur
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001').transform(Number),

  // Base de données
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL est requis'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET doit faire au moins 32 caractères'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET doit faire au moins 32 caractères'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Frontend
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // Anthropic Claude AI
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY est requis'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY est requis'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET est requis'),
  STRIPE_PRICE_PER_USER: z.string().default('1000').transform(Number), // en centimes

  // Chiffrement (clés Odoo au repos)
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY doit faire exactement 64 caractères hexadécimaux (32 octets)')
    .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY doit être une chaîne hexadécimale'),

  // Brevo (email)
  BREVO_SMTP_KEY: z.string().min(1, 'BREVO_SMTP_KEY est requis'),
  BREVO_SMTP_LOGIN: z.string().email('BREVO_SMTP_LOGIN doit être un email valide'),
  EMAIL_FROM: z.string().email().default('leobouton17@gmail.com'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables d\'environnement invalides :');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
