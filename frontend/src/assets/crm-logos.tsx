// Logos des CRM supportés (SVG inline, couleurs officielles des marques).
// Odoo : violet #714B67 — HubSpot : orange #FF7A59

interface LogoProps {
  className?: string;
}

/** Marque Odoo : le double « o » en violet de marque. */
export function OdooLogo({ className = 'h-9 w-auto' }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 44 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Odoo">
      <circle cx="13" cy="12" r="9" stroke="#714B67" strokeWidth="4" />
      <circle cx="31" cy="12" r="9" stroke="#714B67" strokeWidth="4" />
    </svg>
  );
}

/** Marque HubSpot : le « sprocket » orange. */
export function HubspotLogo({ className = 'h-9 w-auto' }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="HubSpot">
      <circle cx="13" cy="22" r="7.5" stroke="#FF7A59" strokeWidth="3" />
      <line x1="13" y1="14.5" x2="13" y2="7" stroke="#FF7A59" strokeWidth="3" strokeLinecap="round" />
      <circle cx="13" cy="4.5" r="3.2" fill="#FF7A59" />
      <line x1="20" y1="20.5" x2="26.5" y2="16.5" stroke="#FF7A59" strokeWidth="3" strokeLinecap="round" />
      <circle cx="28.5" cy="15.5" r="3.2" fill="#FF7A59" />
    </svg>
  );
}
