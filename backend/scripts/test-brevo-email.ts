/**
 * Test d'envoi d'email via Brevo (SMTP).
 * But : vérifier la délivrabilité + prévisualiser l'email de création de compte entreprise.
 * Lancement : npx tsx scripts/test-brevo-email.ts
 */
import nodemailer from 'nodemailer';
import { env } from '../src/config/env';

const DESTINATAIRE = 'leobouton17@gmail.com';

// Données simulées pour l'aperçu
const PRENOM = 'Léo';
const ENTREPRISE = 'GrowCom Demo';
const DASHBOARD_URL = `${env.FRONTEND_URL}/dashboard`;

async function main() {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: env.BREVO_SMTP_LOGIN,
      pass: env.BREVO_SMTP_KEY,
    },
  });

  console.log(`Expéditeur : ${env.EMAIL_FROM}`);
  console.log(`Envoi de l'email de création de compte entreprise à ${DESTINATAIRE}…`);

  const info = await transporter.sendMail({
    from: `"GrowCom" <${env.EMAIL_FROM}>`,
    to: DESTINATAIRE,
    subject: `🎉 Bienvenue sur GrowCom — le compte de ${ENTREPRISE} est activé`,
    html: `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0; padding:0; background:#f4f4f5;">
        <div style="max-width:600px; margin:0 auto; padding:24px 16px;">

          <!-- En-tête / bandeau -->
          <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); border-radius:16px 16px 0 0; padding:40px 40px 32px; text-align:center;">
            <div style="font-size:28px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">GrowCom</div>
            <div style="font-size:13px; color:#e0e7ff; margin-top:6px;">La transparence des commissions commerciales</div>
          </div>

          <!-- Corps -->
          <div style="background:#ffffff; padding:40px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

            <div style="text-align:center; font-size:48px; line-height:1; margin-bottom:16px;">🎉</div>

            <h1 style="font-size:24px; font-weight:800; color:#111827; text-align:center; margin:0 0 8px;">
              Votre compte est activé, ${PRENOM} !
            </h1>
            <p style="font-size:15px; color:#6b7280; text-align:center; margin:0 0 32px; line-height:1.6;">
              Le compte entreprise <strong style="color:#6366f1;">${ENTREPRISE}</strong> est prêt.<br>
              Vous pouvez dès maintenant piloter les commissions de votre équipe.
            </p>

            <!-- Bouton principal -->
            <div style="text-align:center; margin:0 0 32px;">
              <a href="${DASHBOARD_URL}" style="display:inline-block; background:#6366f1; color:#ffffff; padding:15px 36px; border-radius:10px; text-decoration:none; font-weight:700; font-size:15px;">
                Accéder à mon espace
              </a>
            </div>

            <!-- Prochaines étapes -->
            <div style="background:#f9fafb; border:1px solid #eef2ff; border-radius:12px; padding:24px; margin:0 0 24px;">
              <div style="font-size:13px; font-weight:700; color:#6366f1; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:16px;">
                Vos premières étapes
              </div>

              <div style="display:flex; margin-bottom:14px;">
                <span style="font-size:18px; margin-right:12px;">👥</span>
                <span style="font-size:14px; color:#374151; line-height:1.5;"><strong>Invitez votre équipe</strong> — ajoutez vos commerciaux et responsables en quelques clics.</span>
              </div>
              <div style="display:flex; margin-bottom:14px;">
                <span style="font-size:18px; margin-right:12px;">🎯</span>
                <span style="font-size:14px; color:#374151; line-height:1.5;"><strong>Définissez vos plans de variable</strong> — objectifs, règles de commission, paliers.</span>
              </div>
              <div style="display:flex;">
                <span style="font-size:18px; margin-right:12px;">🔗</span>
                <span style="font-size:14px; color:#374151; line-height:1.5;"><strong>Connectez votre CRM</strong> — Odoo ou HubSpot, pour un calcul automatique.</span>
              </div>
            </div>

            <p style="font-size:14px; color:#6b7280; line-height:1.6; margin:0;">
              Une question ? Répondez simplement à cet email, notre équipe vous accompagne.
            </p>
          </div>

          <!-- Pied de page -->
          <div style="background:#ffffff; border-radius:0 0 16px 16px; padding:24px 40px 32px; border-top:1px solid #f3f4f6; text-align:center;">
            <p style="font-size:12px; color:#9ca3af; margin:0 0 4px;">
              GrowCom — Moins de turnover, plus de performance.
            </p>
            <p style="font-size:12px; color:#9ca3af; margin:0;">
              Vous recevez cet email car un compte a été créé avec votre adresse.
            </p>
          </div>

        </div>
      </body>
      </html>
    `,
  });

  console.log('✅ Email envoyé avec succès !');
  console.log('   messageId :', info.messageId);
  console.log('   accepté   :', info.accepted);
  console.log('   rejeté    :', info.rejected);
}

main()
  .catch((err) => {
    console.error('❌ Échec de l\'envoi :', err);
    process.exit(1);
  })
  .then(() => process.exit(0));
