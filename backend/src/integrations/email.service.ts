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
