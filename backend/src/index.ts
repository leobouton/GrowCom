import './config/env'; // Valide les variables d'environnement au démarrage
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { globalRateLimiter } from './middlewares/rateLimiter';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { startScheduler } from './services/scheduler.service';

// Routes
import authRoutes from './routes/auth.routes';
import commissionRoutes from './routes/commission.routes';
import commissionRuleRoutes from './routes/commissionRule.routes';
import odooRoutes from './routes/odoo.routes';
import adminRoutes from './routes/admin.routes';
import billingRoutes from './routes/billing.routes';
import groupRoutes from './routes/group.routes';
import ruleAssignmentRoutes from './routes/ruleAssignment.routes';
import contestRoutes from './routes/contest.routes';
import fileImportRoutes from './routes/fileImport.routes';
import dealAssignmentRoutes from './routes/dealAssignment.routes';
import objectiveSnapshotRoutes from './routes/objectiveSnapshot.routes';
import commissionDisputeRoutes from './routes/commissionDispute.routes';
import payrollReportRoutes from './routes/payrollReport.routes';
import importBatchRoutes from './routes/importBatch.routes';

const app = express();

// ─── Sécurité ───────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ─── Rate limiting global ────────────────────────────────────
app.use(globalRateLimiter);

// ─── Body parsers ────────────────────────────────────────────
// Le webhook Stripe a besoin du raw body — sa route gère son propre parser
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') {
    next();
  } else {
    express.json({ limit: '1mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes API ──────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/commission-rules', commissionRuleRoutes);
app.use('/api/odoo', odooRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/rule-assignments', ruleAssignmentRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/sync', fileImportRoutes);
app.use('/api/deals/:dealId/assignments', dealAssignmentRoutes);
app.use('/api/objective-snapshots', objectiveSnapshotRoutes);
app.use('/api/disputes', commissionDisputeRoutes);
app.use('/api/reports/payroll', payrollReportRoutes);
app.use('/api/imports', importBatchRoutes);

// ─── Gestion des erreurs ─────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Connexion BDD avec réessais automatiques ────────────────
async function connectWithRetry(maxAttempts = 5, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Connexion à la base de données établie');
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err;
      }
      logger.warn(`Tentative ${attempt}/${maxAttempts} échouée — nouvelle tentative dans ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ─── Démarrage ───────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    await connectWithRetry();

    app.listen(env.PORT, () => {
      logger.info(`Serveur GrowCom démarré`, {
        port: env.PORT,
        env: env.NODE_ENV,
        url: `http://localhost:${env.PORT}`,
      });
      startScheduler();
    });
  } catch (err) {
    logger.error('Impossible de démarrer le serveur', { error: err });
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
  logger.info('Arrêt du serveur (SIGTERM)');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Arrêt du serveur (SIGINT)');
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap().catch((err) => {
  logger.error('Erreur fatale au démarrage', { error: err });
  process.exit(1);
});
