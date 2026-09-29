/**
 * Moteur de calcul de commission GrowCom — point d'entrée unique.
 * Importé par le backend, le frontend et le site marketing : ne jamais recopier ce calcul ailleurs.
 */

export * from './types';
export { roundCents, applyShare, allocateByShares, assertValidShares, SHARES_SUM_TOLERANCE } from './rounding';
export {
  computeCommission,
  calculateCommissionAmount,
  computeTierProgress,
  findReachedTier,
  sortTiers,
  formatRatePercent,
} from './compute';
export {
  resolveBasisAmount,
  resolveEffectiveConfig,
  computePlanComponentsAmount,
} from './basis';
export type { CommissionBasisInput } from './basis';
export {
  simulateAgencySale,
  validateSimulationInput,
  computeFees,
  buildRemunerationConfig,
  projectYear,
  tiersFromThresholds,
  DEFAULT_VAT_RATE,
  MAX_SALES_PER_YEAR,
} from './simulator';
export type {
  AgencySaleSimulationInput,
  AgencySaleSimulationResult,
  AnnualProjection,
  DeductionAmount,
  DeductionInput,
  DeductionMode,
  FeesBreakdown,
  FeesInputMode,
  FeesTaxBasis,
  NegotiatorStatus,
  ParticipantNet,
  ProjectionSale,
  RemunerationInput,
  RemunerationMode,
  SimulationIssue,
  SimulationOutcome,
} from './simulator';
