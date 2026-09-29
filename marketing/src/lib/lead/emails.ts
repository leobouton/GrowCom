/**
 * Contenu des emails envoyés via Brevo : le document demandé (au visiteur)
 * et l'alerte « demande de rappel » (à l'équipe GrowCom).
 */
import type { Lead } from './validation';

export interface DeliveryLinks {
  simulation: string | null;
  templateXlsx: string;
  templatePdf: string;
  simulator: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const button = (href: string, label: string, primary = false) => `
  <tr><td style="padding:6px 0">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 22px;border-radius:999px;font:600 15px/1.2 Arial,Helvetica,sans-serif;text-decoration:none;${
      primary ? 'background:#4f46e5;color:#ffffff' : 'background:#ffffff;color:#17161c;border:1.5px solid #cfc5b2'
    }">${escapeHtml(label)}</a>
  </td></tr>`;

function layout(title: string, body: string, footer: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f4ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ee">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e0d8c9;border-radius:18px">
        <tr><td style="padding:28px 32px 8px;font:500 24px/1 Georgia,'Times New Roman',serif;color:#17161c">
          GrowCom <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#c8e45c;border:2px solid #17161c;vertical-align:middle"></span>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#3b3a44">${body}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:18px 32px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#625f6b">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function buildDeliveryEmail(lead: Lead, links: DeliveryLinks, siteUrl: string, contactEmail: string) {
  const hello = lead.firstName ? `Bonjour ${escapeHtml(lead.firstName)},` : 'Bonjour,';
  const subject =
    lead.source === 'simulateur'
      ? 'Votre calcul de commission et le modèle de grille'
      : 'Votre modèle de grille de commissionnement';

  const intro =
    lead.source === 'simulateur'
      ? 'Merci d’avoir utilisé le simulateur GrowCom. Voici de quoi retrouver votre calcul et le modèle de grille de commissionnement.'
      : 'Voici le modèle de grille de commissionnement que vous avez demandé, en version Excel (modifiable) et PDF.';

  const buttons = [
    links.simulation ? button(links.simulation, 'Revoir ma simulation', true) : '',
    button(links.templateXlsx, 'Modèle de grille (Excel)', !links.simulation),
    button(links.templatePdf, 'Modèle de grille (PDF)'),
  ].join('');

  const callback = lead.phone
    ? '<p style="margin:20px 0 0">Vous nous avez laissé votre numéro : nous vous rappelons très vite pour en parler.</p>'
    : '';

  const html = layout(
    subject,
    `<p style="margin:0 0 14px;color:#17161c">${hello}</p>
     <p style="margin:0 0 18px">${intro}</p>
     <table role="presentation" cellpadding="0" cellspacing="0">${buttons}</table>
     <p style="margin:22px 0 0">Le modèle Excel calcule automatiquement la commission de chaque vente à partir de votre grille (par tranche, au taux atteint ou avec effet rétroactif).</p>
     ${callback}
     <p style="margin:22px 0 0">GrowCom automatise ce calcul pour toute votre équipe : chaque négociateur voit le détail de sa commission et son prochain palier, en temps réel. Si le sujet vous intéresse, répondez simplement à cet email.</p>
     <p style="margin:22px 0 0;color:#17161c">L’équipe GrowCom</p>`,
    `Vous recevez cet email car ce document a été demandé sur <a href="${escapeHtml(siteUrl)}" style="color:#625f6b">growcom.fr</a> avec votre adresse.
     GrowCom pourra vous envoyer ponctuellement des informations sur son offre. Pour ne plus rien recevoir, répondez « STOP » à cet email
     ou écrivez à ${escapeHtml(contactEmail)}.`,
  );

  const text = [
    lead.firstName ? `Bonjour ${lead.firstName},` : 'Bonjour,',
    '',
    intro,
    '',
    links.simulation ? `Revoir ma simulation : ${links.simulation}` : '',
    `Modèle de grille (Excel) : ${links.templateXlsx}`,
    `Modèle de grille (PDF) : ${links.templatePdf}`,
    '',
    lead.phone ? 'Vous nous avez laissé votre numéro : nous vous rappelons très vite.' : '',
    'GrowCom automatise ce calcul pour toute votre équipe. Si le sujet vous intéresse, répondez simplement à cet email.',
    '',
    'L’équipe GrowCom',
    '',
    `Pour ne plus rien recevoir, répondez « STOP » à cet email ou écrivez à ${contactEmail}.`,
  ]
    .filter((line, i, lines) => !(line === '' && lines[i - 1] === ''))
    .join('\n');

  return { subject, html, text };
}

/** Alerte interne : un visiteur a laissé son numéro pour être rappelé. */
export function buildCallbackNotification(lead: Lead, simulationLink: string | null) {
  const rows: Array<[string, string | null]> = [
    ['Téléphone', lead.phone],
    ['Email', lead.email],
    ['Prénom', lead.firstName],
    ['Agence', lead.agency],
    ['Ville', lead.city],
    ['Page', lead.source === 'simulateur' ? 'Simulateur' : 'Modèle de grille'],
    ['Campagne', [lead.attribution.utm_campaign, lead.attribution.cid].filter(Boolean).join(' · ') || null],
    ['Source', [lead.attribution.utm_source, lead.attribution.utm_medium].filter(Boolean).join(' / ') || null],
    ['Simulation', simulationLink],
  ];
  const filled = rows.filter((row): row is [string, string] => Boolean(row[1]));
  const subject = `📞 Demande de rappel : ${lead.agency ?? lead.email}`;
  const html = layout(
    subject,
    `<p style="margin:0 0 14px;color:#17161c"><strong>Un visiteur souhaite être rappelé.</strong></p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="font:14px/1.5 Arial,Helvetica,sans-serif">
       ${filled
         .map(
           ([label, value]) =>
             `<tr><td style="padding:4px 16px 4px 0;color:#625f6b;vertical-align:top">${label}</td><td style="padding:4px 0;color:#17161c">${escapeHtml(value)}</td></tr>`,
         )
         .join('')}
     </table>`,
    'Alerte automatique du site growcom.fr.',
  );
  const text = filled.map(([label, value]) => `${label} : ${value}`).join('\n');
  return { subject, html, text };
}
