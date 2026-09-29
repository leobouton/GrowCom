/**
 * Formulaire « Recevoir ce calcul en PDF + le modèle de grille ».
 * Email obligatoire, téléphone facultatif (= demande de rappel). Envoi en POST vers /api/lead,
 * jamais dans l'URL. Le calcul du simulateur n'est jamais bloqué par ce formulaire.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AgencySaleSimulationResult } from '@shared/commission-engine';
import { ROUTES, SITE, TEMPLATE_FILES } from '../../lib/site';
import { ATTRIBUTION_KEYS, normalizeEmail, normalizePhone, type Attribution, type LeadSource } from '../../lib/lead/validation';
import { encodeState, type SimulatorState } from '../../simulator/state';

const TURNSTILE_SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined;
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(script);
  });
  return turnstileLoading;
}

/** Provenance de la visite (campagne d'emailing…) lue dans l'adresse de la page. */
function readAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const result: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value) result[key] = value;
  }
  return result;
}

type Field = 'email' | 'phone' | 'firstName' | 'agency' | 'city';
type Status = 'idle' | 'submitting' | 'success' | 'error';

interface Props {
  source: LeadSource;
  /** Simulation en cours (page simulateur) : permet le PDF du calcul. */
  simulation?: { state: SimulatorState; result: AgencySaleSimulationResult } | null;
  submitLabel?: string;
}

function Input({
  label,
  name,
  type = 'text',
  autoComplete,
  inputMode,
  required,
  hint,
  error,
  value,
  onChange,
}: {
  label: ReactNode;
  name: Field;
  type?: string;
  autoComplete?: string;
  inputMode?: 'email' | 'tel' | 'text';
  required?: boolean;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[0.88rem] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
        className={[
          'w-full rounded-xl border bg-card px-3.5 py-2.5 text-[1rem] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-primary-600 focus:ring-2 focus:ring-primary-600/20',
          error ? 'border-[#c2410c]' : 'border-line-strong hover:border-ink/40',
        ].join(' ')}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-[0.8rem] leading-snug text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[0.8rem] font-medium text-[#c2410c]">
          {error}
        </p>
      )}
    </div>
  );
}

function DownloadLink({ href, children, onClick, primary = false }: { href?: string; children: ReactNode; onClick?: () => void; primary?: boolean }) {
  const className = [
    'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-[0.95rem] font-semibold transition-colors',
    primary ? 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700' : 'border-line-strong bg-card text-ink hover:border-ink',
  ].join(' ');
  const icon = (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <path d="M9 2.5v9M5 8l4 4 4-4M3 15h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return href ? (
    <a href={href} download className={className}>
      {children}
      {icon}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {children}
      {icon}
    </button>
  );
}

export default function LeadForm({ source, simulation = null, submitLabel = 'Recevoir le document' }: Props) {
  const [values, setValues] = useState<Record<Field, string>>({ email: '', phone: '', firstName: '', agency: '', city: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [pdfState, setPdfState] = useState<'idle' | 'working' | 'error'>('idle');
  const [token, setToken] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const honeypot = useRef<HTMLInputElement>(null);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  // Vérification anti-robot Cloudflare (invisible dans la plupart des cas), chargée à l'ouverture du formulaire
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileBox.current) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !turnstileBox.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(turnstileBox.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'fr',
          appearance: 'interaction-only',
          callback: (value: string) => setToken(value),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        });
      })
      .catch(() => setMessage('La vérification anti-robot n’a pas pu se charger. Désactivez un éventuel bloqueur et rechargez la page.'));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, []);

  useEffect(() => {
    if (status === 'success') successHeading.current?.focus();
  }, [status]);

  const set = (field: Field) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const simulationQuery = simulation ? encodeState(simulation.state) : null;
  const simulationLink = `${SITE.url}${ROUTES.simulator}${simulationQuery ? `?${simulationQuery}` : ''}`;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const clientErrors: Partial<Record<Field, string>> = {};
    if (!normalizeEmail(values.email)) clientErrors.email = 'Adresse email invalide.';
    if (values.phone.trim() && !normalizePhone(values.phone)) clientErrors.phone = 'Numéro invalide (ex. 06 12 34 56 78).';
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;
    if (TURNSTILE_SITE_KEY && !token) {
      setMessage('Merci de patienter une seconde : la vérification anti-robot se termine.');
      return;
    }

    setStatus('submitting');
    setMessage(null);
    try {
      const response = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          source,
          simulation: simulationQuery,
          attribution: readAttribution(),
          website: honeypot.current?.value ?? '',
          startedAt: startedAt.current,
          turnstileToken: token,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        emailSent?: boolean;
        message?: string;
        fields?: Partial<Record<Field, string>>;
      };
      if (response.ok && data.ok) {
        setEmailSent(Boolean(data.emailSent));
        setStatus('success');
        return;
      }
      if (data.fields) setErrors(data.fields);
      setMessage(data.message ?? 'Une erreur est survenue. Réessayez dans un instant.');
      setStatus('error');
      if (widgetId.current && window.turnstile) {
        window.turnstile.reset(widgetId.current);
        setToken(null);
      }
    } catch {
      setMessage('Connexion impossible. Vérifiez votre réseau et réessayez.');
      setStatus('error');
    }
  };

  const downloadPdf = async () => {
    if (!simulation) return;
    setPdfState('working');
    try {
      const { downloadSimulationPdf } = await import('../../lib/pdf/simulation-pdf');
      await downloadSimulationPdf(simulation.state, simulation.result, simulationLink);
      setPdfState('idle');
    } catch {
      setPdfState('error');
    }
  };

  if (status === 'success') {
    return (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime ring-[1.5px] ring-ink" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h3 ref={successHeading} tabIndex={-1} className="font-display text-[1.5rem] leading-tight text-ink outline-none" style={{ fontWeight: 480 }}>
            C’est prêt.
          </h3>
        </div>
        <div className="mt-5 space-y-2.5">
          {simulation && (
            <DownloadLink onClick={downloadPdf} primary>
              {pdfState === 'working' ? 'Préparation du PDF…' : 'Télécharger mon calcul (PDF)'}
            </DownloadLink>
          )}
          <DownloadLink href={TEMPLATE_FILES.xlsx} primary={!simulation}>
            Modèle de grille (Excel, modifiable)
          </DownloadLink>
          <DownloadLink href={TEMPLATE_FILES.pdf}>Modèle de grille (PDF, à imprimer)</DownloadLink>
        </div>
        {pdfState === 'error' && (
          <p className="mt-3 text-[0.85rem] font-medium text-[#c2410c]" role="alert">
            Le PDF n’a pas pu être généré sur cet appareil. Le lien reçu par email permet de retrouver votre simulation.
          </p>
        )}
        <p className="mt-5 text-[0.88rem] leading-relaxed text-ink-soft" aria-live="polite">
          {emailSent ? (
            <>
              Nous vous avons aussi envoyé ces liens à <strong className="text-ink">{normalizeEmail(values.email)}</strong>.
            </>
          ) : (
            'Gardez ces fichiers : ils sont à vous.'
          )}
          {values.phone.trim() && ' Nous vous rappelons très vite.'}
        </p>
      </div>
    );
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
      <div className="space-y-4">
        <Input label={<>Email professionnel <span className="text-muted">(obligatoire)</span></>} name="email" type="email" inputMode="email" autoComplete="email" required value={values.email} onChange={set('email')} error={errors.email} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Prénom" name="firstName" autoComplete="given-name" value={values.firstName} onChange={set('firstName')} error={errors.firstName} />
          <Input label="Agence" name="agency" autoComplete="organization" value={values.agency} onChange={set('agency')} error={errors.agency} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Ville" name="city" autoComplete="address-level2" value={values.city} onChange={set('city')} error={errors.city} />
          <Input
            label={<>Téléphone <span className="text-muted">(facultatif)</span></>}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={set('phone')}
            error={errors.phone}
            hint="Seulement si vous souhaitez qu’on vous rappelle."
          />
        </div>

        {/* Champ piège : invisible pour un humain, rempli par les robots */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Site web
            <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        <div ref={turnstileBox} className="empty:hidden" />

        {message && (
          <p className="rounded-xl bg-[#fff1e8] px-4 py-3 text-[0.88rem] font-medium text-[#9a3412]" role="alert">
            {message}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-primary w-full disabled:cursor-wait disabled:opacity-70">
          {submitting ? 'Envoi…' : submitLabel}
        </button>

        <p className="text-[0.78rem] leading-relaxed text-muted">
          Vous recevrez le document par email. GrowCom pourra aussi vous envoyer ponctuellement des informations sur son offre ; vous
          pourrez vous désinscrire à tout moment.{' '}
          <a href={ROUTES.privacy} className="underline underline-offset-2 hover:text-ink">
            Politique de confidentialité
          </a>
          .
        </p>
      </div>
    </form>
  );
}
