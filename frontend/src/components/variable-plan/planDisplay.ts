/**
 * Helpers d'AFFICHAGE et de VALIDATION du plan de variable.
 * - humanize* : transforme un composant en phrase française lisible par un manager
 *   de TPE (jamais de JSON ni de noms de champs techniques).
 * - validate* : garde-fous de l'édition inline (paliers cohérents, taux positifs…).
 * AUCUN calcul de commission ici : la simulation passe par l'API (moteur réel).
 */
import type {
  CommissionRuleConfig,
  GeneratedPlanComponentDraft,
  PlanObjectiveInput,
} from '@shared/types';
import { CommissionRuleType } from '@shared/types';

export function formatEur(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'chaque mois',
  quarterly: 'chaque trimestre',
  semester: 'chaque semestre',
  annual: 'sur l\'année',
  custom: 'sur la période définie',
};

function basisPhrase(config: CommissionRuleConfig): string {
  if (config.calculationBasis === 'MARGIN') return 'de la marge';
  if (config.calculationBasis === 'PER_UNIT') return 'par consultant placé';
  return 'du montant de la vente';
}

/** Phrase française décrivant une règle de commission d'un plan. */
export function humanizeCommission(name: string, config: CommissionRuleConfig): string {
  const isRecurring = config.appliesToEventType === 'MISSION_MONTH';
  const parts: string[] = [];

  if (config.calculationBasis === 'PER_UNIT') {
    parts.push(`${formatEur(config.fixedAmount ?? 0)} par mois et par consultant placé`);
  } else if (config.type === CommissionRuleType.PERCENTAGE) {
    const pct = ((config.rate ?? 0) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    parts.push(
      isRecurring
        ? `${pct} % ${config.calculationBasis === 'MARGIN' ? 'de la marge mensuelle' : 'du CA mensuel'} de la mission`
        : `${pct} % ${basisPhrase(config)}`,
    );
  } else if (config.type === CommissionRuleType.FIXED) {
    parts.push(`${formatEur(config.fixedAmount ?? 0)} fixes par vente gagnée`);
  } else if (config.type === CommissionRuleType.TIERED && config.tiers) {
    const sorted = [...config.tiers].sort((a, b) => a.min - b.min);
    const tierPhrases = sorted.map((t) =>
      t.max != null
        ? `${(t.rate * 100).toLocaleString('fr-FR')} % de ${formatEur(t.min)} à ${formatEur(t.max)}`
        : `${(t.rate * 100).toLocaleString('fr-FR')} % au-delà de ${formatEur(t.min)}`,
    );
    parts.push(`par paliers ${config.calculationBasis === 'MARGIN' ? 'sur la marge' : 'sur le CA'} : ${tierPhrases.join(', ')}`);
  }

  if (isRecurring && config.calculationBasis !== 'PER_UNIT') {
    parts.push('versés chaque mois tant que la mission tourne');
  }
  if (config.floor != null) parts.push(`uniquement à partir de ${formatEur(config.floor)}`);
  if (config.cap != null) parts.push(`plafonné à ${formatEur(config.cap)}`);
  if (config.paymentTrigger === 'CLIENT_PAID') parts.push('payé une fois que le client a réglé sa facture');

  return `« ${name} » : ${parts.join(', ')}.`;
}

/** Phrase française décrivant un objectif d'un plan. */
export function humanizeObjective(objective: PlanObjectiveInput): string {
  const unitLabel = objective.unit === 'deals' ? 'ventes' : objective.unit === 'marge' ? '€ de marge' : '€ de chiffre d\'affaires';
  const period = PERIOD_LABELS[objective.periodType] ?? 'sur la période';
  const parts: string[] = [
    `Objectif « ${objective.label} » : atteindre ${objective.target.toLocaleString('fr-FR')} ${unitLabel} ${period}`,
  ];

  const mode = objective.bonusMode ?? (objective.bonus?.enabled ? 'simple' : 'none');
  if (mode === 'tiered' && objective.bonusTiers && objective.bonusTiers.length > 0) {
    const tiers = [...objective.bonusTiers].sort((a, b) => a.threshold - b.threshold);
    const tierPhrases = tiers.map((t) =>
      t.reward.type === 'fixed'
        ? `${formatEur(t.reward.value)} dès ${t.threshold} %`
        : `${t.reward.value.toLocaleString('fr-FR')} % du réalisé dès ${t.threshold} %`,
    );
    parts.push(`primes par paliers : ${tierPhrases.join(', ')}`);
  } else if (mode === 'simple' && objective.bonus?.enabled) {
    parts.push(
      objective.bonus.type === 'fixed'
        ? `prime de ${formatEur(objective.bonus.value)} en cas de dépassement`
        : `prime de ${objective.bonus.value.toLocaleString('fr-FR')} % du dépassement`,
    );
  }
  if (objective.recurrence && objective.recurrence !== 'none') {
    parts.push('se renouvelle automatiquement');
  }
  return `${parts.join(' — ')}.`;
}

/** Phrase française pour n'importe quel composant du plan. */
export function humanizeComponent(component: GeneratedPlanComponentDraft): string {
  return component.kind === 'COMMISSION_RULE'
    ? humanizeCommission(component.name, component.config)
    : humanizeObjective(component.objective);
}

/** Badge court du type de composant. */
export function componentBadge(component: GeneratedPlanComponentDraft): { label: string; variant: 'blue' | 'purple' | 'green' } {
  if (component.kind === 'OBJECTIVE') return { label: '🎯 Objectif', variant: 'green' };
  return component.config.appliesToEventType === 'MISSION_MONTH'
    ? { label: '🔁 Récurrent mensuel', variant: 'purple' }
    : { label: '💰 One-shot', variant: 'blue' };
}

// ─── Validation de l'édition inline ─────────────────────────────────────────

/** Retourne un message d'erreur (français) ou null si le composant est cohérent. */
export function validateComponent(component: GeneratedPlanComponentDraft): string | null {
  if (component.kind === 'OBJECTIVE') {
    const o = component.objective;
    if (!(o.target > 0)) return 'La cible de l\'objectif doit être supérieure à 0';
    if (o.bonus?.enabled && o.bonus.value < 0) return 'La prime ne peut pas être négative';
    if (o.bonusTiers) {
      const sorted = [...o.bonusTiers].sort((a, b) => a.threshold - b.threshold);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].threshold <= 0) return 'Un seuil de palier doit être supérieur à 0 %';
        if (sorted[i].reward.value < 0) return 'Une prime de palier ne peut pas être négative';
        if (i > 0 && sorted[i].threshold === sorted[i - 1].threshold) return 'Deux paliers ont le même seuil';
      }
    }
    return null;
  }

  const config = component.config;
  if (config.type === CommissionRuleType.PERCENTAGE || config.calculationBasis === 'PER_UNIT') {
    if (config.type === CommissionRuleType.PERCENTAGE) {
      if (config.rate == null || config.rate <= 0 || config.rate > 1) {
        return 'Le taux doit être compris entre 0 et 100 %';
      }
    }
  }
  if (config.type === CommissionRuleType.FIXED && (config.fixedAmount == null || config.fixedAmount <= 0)) {
    return 'Le montant fixe doit être supérieur à 0';
  }
  if (config.type === CommissionRuleType.TIERED) {
    const tiers = config.tiers ?? [];
    if (tiers.length === 0) return 'Il faut au moins un palier';
    const sorted = [...tiers].sort((a, b) => a.min - b.min);
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (t.rate < 0 || t.rate > 1) return 'Un taux de palier doit être entre 0 et 100 %';
      if (t.max != null && t.max <= t.min) return 'Chaque palier doit avoir un maximum supérieur à son minimum';
      if (i > 0) {
        const prev = sorted[i - 1];
        if (prev.max == null) return 'Seul le dernier palier peut être sans maximum';
        if (t.min < prev.max) return 'Les paliers ne doivent pas se chevaucher';
      }
      if (i === sorted.length - 1 && t.max != null) return 'Le dernier palier doit rester ouvert (sans maximum)';
    }
  }
  if (config.cap != null && config.cap <= 0) return 'Le plafond doit être supérieur à 0';
  if (config.floor != null && config.floor < 0) return 'Le seuil minimum ne peut pas être négatif';
  if (config.cap != null && config.floor != null && config.cap < config.floor) {
    return 'Le plafond ne peut pas être inférieur au seuil minimum';
  }
  return null;
}

/** Extraction d'un message d'erreur API lisible (pattern axios de l'app). */
export function getApiErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'isAxiosError' in err) {
    const axiosErr = err as unknown as {
      response?: { status?: number; data?: { error?: { message?: string } } };
      code?: string;
      message: string;
    };
    if (axiosErr.code === 'ECONNABORTED') return 'Le serveur met trop de temps à répondre — réessayez.';
    const apiMsg = axiosErr.response?.data?.error?.message;
    if (apiMsg) return apiMsg;
    if (!axiosErr.response) return 'Impossible de joindre le serveur — vérifiez votre connexion et réessayez.';
    return `Erreur serveur (${axiosErr.response.status ?? '?'}) — réessayez.`;
  }
  return err instanceof Error ? err.message : 'Erreur inattendue — réessayez.';
}
