import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: env.BREVO_SMTP_LOGIN,
    pass: env.BREVO_SMTP_KEY,
  },
});

export const emailService = {
  async sendInvitation(
    toEmail: string,
    firstName: string,
    inviteToken: string,
  ): Promise<void> {
    const inviteUrl = `${env.FRONTEND_URL}/invitation?token=${inviteToken}`;

    try {
      await transporter.sendMail({
        from: `"GrowCom" <${env.EMAIL_FROM}>`,
        to: toEmail,
        subject: 'Invitation à rejoindre GrowCom',
        html: `
          <!DOCTYPE html>
          <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
              .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; }
              .logo { font-size: 24px; font-weight: 800; color: #6366f1; margin-bottom: 32px; }
              h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 16px; }
              p { color: #374151; line-height: 1.6; margin-bottom: 16px; }
              .btn { display: inline-block; background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0; }
              .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; }
              .url { word-break: break-all; color: #6366f1; font-size: 13px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">GrowCom</div>
              <h1>Bonjour ${firstName} 👋</h1>
              <p>Vous avez été invité(e) à rejoindre <strong>GrowCom</strong>, la plateforme de transparence des commissions commerciales.</p>
              <p>Cliquez sur le bouton ci-dessous pour créer votre mot de passe et accéder à votre espace :</p>
              <a href="${inviteUrl}" class="btn">Créer mon compte</a>
              <p>Ou copiez ce lien dans votre navigateur :</p>
              <p class="url">${inviteUrl}</p>
              <div class="footer">
                <p>Ce lien est valable 72 heures. Si vous n'avez pas demandé cette invitation, ignorez cet email.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      logger.info('Email d\'invitation envoyé', { to: toEmail });
    } catch (err) {
      logger.error('Erreur envoi email d\'invitation', { to: toEmail, error: err });
      throw new Error('Impossible d\'envoyer l\'email d\'invitation');
    }
  },

  async sendEmailVerification(toEmail: string, firstName: string, verificationToken: string): Promise<void> {
    const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    try {
      await transporter.sendMail({
        from: `"GrowCom" <${env.EMAIL_FROM}>`,
        to: toEmail,
        subject: 'Confirmez votre adresse email GrowCom',
        html: `
          <!DOCTYPE html>
          <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
              .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; }
              .logo { font-size: 24px; font-weight: 800; color: #6366f1; margin-bottom: 32px; }
              h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 16px; }
              p { color: #374151; line-height: 1.6; margin-bottom: 16px; }
              .btn { display: inline-block; background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0; }
              .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; }
              .url { word-break: break-all; color: #6366f1; font-size: 13px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">GrowCom</div>
              <h1>Bienvenue ${firstName} !</h1>
              <p>Votre espace GrowCom est presque prêt. Il vous suffit de confirmer votre adresse email pour activer votre compte.</p>
              <a href="${verifyUrl}" class="btn">Confirmer mon email</a>
              <p>Ou copiez ce lien dans votre navigateur :</p>
              <p class="url">${verifyUrl}</p>
              <div class="footer">
                <p>Ce lien est valable 24 heures. Si vous n'avez pas créé de compte GrowCom, ignorez cet email.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      logger.info('Email de vérification envoyé', { to: toEmail });
    } catch (err) {
      logger.error('Erreur envoi email de vérification', { to: toEmail, error: err });
      // Ne pas propager l'erreur — l'inscription ne doit pas échouer si l'email ne part pas
    }
  },

  async sendOdooLimitWarning(toEmail: string, firstName: string, currentCount: number, remaining: number): Promise<void> {
    try {
      await transporter.sendMail({
        from: `"GrowCom" <${env.EMAIL_FROM}>`,
        to: toEmail,
        subject: `⚠️ Attention — Il ne reste plus que ${remaining} deal(s) avant la limite de synchronisation`,
        html: `
          <!DOCTYPE html>
          <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
              .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; }
              .logo { font-size: 24px; font-weight: 800; color: #6366f1; margin-bottom: 32px; }
              .alert-box { background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0; }
              .alert-box h2 { color: #92400e; font-size: 18px; margin: 0 0 8px 0; }
              .alert-box p { color: #78350f; margin: 0; line-height: 1.5; }
              .stat { font-size: 36px; font-weight: 800; color: #f59e0b; text-align: center; margin: 8px 0; }
              .stat-label { text-align: center; color: #6b7280; font-size: 13px; margin-bottom: 16px; }
              h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 16px; }
              p { color: #374151; line-height: 1.6; margin-bottom: 16px; }
              .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 16px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">GrowCom</div>
              <h1>Bonjour ${firstName},</h1>
              <p>Votre synchronisation Odoo vient de détecter un point d'attention important :</p>
              <div class="alert-box">
                <h2>⚠️ Limite de synchronisation bientôt atteinte</h2>
                <p>Votre CRM Odoo contient actuellement <strong>${currentCount} deals actifs</strong>. La synchronisation GrowCom est limitée à <strong>1 000 deals</strong>.</p>
              </div>
              <div class="stat">${remaining}</div>
              <div class="stat-label">deal(s) restant(s) avant le plafond</div>
              <p>Au-delà de 1 000 deals, certaines opportunités ne seront plus synchronisées dans GrowCom, ce qui peut fausser le calcul des commissions de vos commerciaux.</p>
              <p><strong>Action requise :</strong> Contactez le support GrowCom dès que possible pour anticiper cette limite et éviter toute interruption de service.</p>
              <div class="footer">
                <p>Ce message est envoyé automatiquement par GrowCom à chaque synchronisation tant que le seuil de 950 deals est dépassé.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      logger.info('Email d\'alerte limite Odoo envoyé', { to: toEmail, currentCount, remaining });
    } catch (err) {
      logger.error('Erreur envoi email alerte limite Odoo', { to: toEmail, error: err });
      // Ne pas propager — l'alerte email ne doit pas bloquer la synchronisation
    }
  },

  async sendPasswordReset(toEmail: string, firstName: string, resetToken: string): Promise<void> {
    const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await transporter.sendMail({
        from: `"GrowCom" <${env.EMAIL_FROM}>`,
        to: toEmail,
        subject: 'Réinitialisation de votre mot de passe GrowCom',
        html: `
          <!DOCTYPE html>
          <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
              .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; }
              .logo { font-size: 24px; font-weight: 800; color: #6366f1; margin-bottom: 32px; }
              h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 16px; }
              p { color: #374151; line-height: 1.6; margin-bottom: 16px; }
              .btn { display: inline-block; background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0; }
              .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="logo">GrowCom</div>
              <h1>Réinitialisation du mot de passe</h1>
              <p>Bonjour ${firstName},</p>
              <p>Vous avez demandé à réinitialiser votre mot de passe GrowCom.</p>
              <a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe</a>
              <div class="footer">
                <p>Ce lien est valable 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      logger.info('Email de réinitialisation envoyé', { to: toEmail });
    } catch (err) {
      logger.error('Erreur envoi email de réinitialisation', { to: toEmail, error: err });
      throw new Error('Impossible d\'envoyer l\'email de réinitialisation');
    }
  },
};
