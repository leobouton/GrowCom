/**
 * Champs de saisie du simulateur : nombres à la française, choix segmentés, listes.
 * Tous accessibles au clavier et aux lecteurs d'écran (vrais <input>, <label>, <fieldset>).
 */
import { useId, useState, type ReactNode } from 'react';

const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** « 285 000 », « 4,5 » ou « 285000.50 » → nombre ; null si illisible. */
export function parseFrenchNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s  €%]/g, '').replace(',', '.');
  if (cleaned === '') return 0;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  hint?: ReactNode;
  error?: string;
  /** Libellé masqué (le contexte le donne déjà, ex. dans un tableau). */
  hideLabel?: boolean;
  className?: string;
  min?: number;
  max?: number;
  integer?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  error,
  hideLabel = false,
  className = '',
  min,
  max,
  integer = false,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = draft ?? NUMBER_FORMAT.format(value);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

  const commit = (raw: string) => {
    const parsed = parseFrenchNumber(raw);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    let next = integer ? Math.round(parsed) : parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setInvalid(false);
    onChange(next);
  };

  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[0.88rem] font-medium text-ink'}>
        {label}
      </label>
      <div
        className={[
          'flex items-center rounded-xl border bg-card transition-colors focus-within:border-primary-600 focus-within:ring-2 focus-within:ring-primary-600/20',
          error || invalid ? 'border-[#c2410c]' : 'border-line-strong hover:border-ink/40',
        ].join(' ')}
      >
        <input
          id={id}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={shown}
          aria-invalid={error || invalid ? true : undefined}
          aria-describedby={describedBy}
          onFocus={(e) => {
            setDraft(NUMBER_FORMAT.format(value));
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => {
            setDraft(null);
            setInvalid(false);
          }}
          className="num w-full min-w-0 rounded-xl bg-transparent px-3.5 py-2.5 text-[1rem] text-ink outline-none"
        />
        {suffix && (
          <span aria-hidden="true" className="pr-3.5 text-[0.95rem] text-muted">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
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

interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface SegmentedProps<T extends string> {
  legend: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  hideLegend?: boolean;
  size?: 'sm' | 'md';
}

/** Choix exclusif en boutons collés (vrais boutons radio, navigables aux flèches). */
export function Segmented<T extends string>({ legend, value, options, onChange, hideLegend, size = 'md' }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset>
      <legend className={hideLegend ? 'sr-only' : 'mb-1.5 text-[0.88rem] font-medium text-ink'}>{legend}</legend>
      <div className="flex rounded-xl border border-line-strong bg-paper p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={[
              'relative flex flex-1 cursor-pointer items-center justify-center rounded-[0.6rem] text-center font-medium transition-colors',
              size === 'sm' ? 'px-2 py-1.5 text-[0.82rem]' : 'px-3 py-2 text-[0.9rem]',
              value === option.value ? 'bg-card text-ink shadow-[0_1px_3px_rgb(23_22_28/0.14)]' : 'text-muted hover:text-ink',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary-600',
            ].join(' ')}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Choix exclusif en cartes, avec une ligne d'explication par option. */
export function ChoiceCards<T extends string>({ legend, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-[0.88rem] font-medium text-ink">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={[
                'relative cursor-pointer rounded-xl border p-3.5 transition-colors',
                selected ? 'border-ink bg-card shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line-strong bg-card/60 hover:border-ink/40',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-600',
              ].join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-[0.9rem] font-semibold text-ink">
                <span
                  aria-hidden="true"
                  className={[
                    'h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-ink',
                    selected ? 'bg-lime' : 'bg-transparent',
                  ].join(' ')}
                />
                {option.label}
              </span>
              {option.description && <span className="mt-1.5 block text-[0.8rem] leading-snug text-muted">{option.description}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
  hideLabel?: boolean;
  className?: string;
}

export function SelectField<T extends string>({ label, value, options, onChange, hideLabel, className = '' }: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-[0.88rem] font-medium text-ink'}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full appearance-none rounded-xl border border-line-strong bg-card bg-[length:12px] bg-[right_0.9rem_center] bg-no-repeat py-2.5 pl-3.5 pr-9 text-[0.95rem] text-ink hover:border-ink/40 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/20"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23625f6b' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
        }}
      >
        {(Object.keys(options) as T[]).map((key) => (
          <option key={key} value={key}>
            {options[key]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Bloc de formulaire numéroté, façon rubrique de bordereau. */
export function FormSection({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-[1.3rem] border border-line bg-card/80 p-5 shadow-[var(--shadow-card)] sm:p-7">
      <h2 id={id} className="flex items-center gap-3 text-[1.05rem] font-semibold text-ink">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-ink font-display text-[0.9rem]" aria-hidden="true">
          {step}
        </span>
        {title}
      </h2>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-strong text-muted transition-colors hover:border-ink hover:text-ink"
    >
      {children}
    </button>
  );
}

export function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function AddButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full px-1 py-1 text-[0.88rem] font-semibold text-primary-700 transition-colors hover:text-primary-900 disabled:cursor-not-allowed disabled:text-muted/60"
    >
      <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-current text-[0.85rem] leading-none">
        +
      </span>
      {children}
    </button>
  );
}
