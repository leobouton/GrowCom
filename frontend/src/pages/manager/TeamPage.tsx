import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../../services/api';
import { authApiService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/auth.store';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { OrgChart } from '../../components/team/OrgChart';
import type { PublicUser, Objective, RuleAssignment, Contest, CommissionDispute, DisputeStatus } from '@shared/types';
import { MONTHS } from '../../components/objectives';
import { ObjectiveWizard } from '../../components/ObjectiveWizard';
import { UserRole, AssigneeType, ContestStatus, ContestMetric, RuleScope } from '@shared/types';
import { ruleAssignmentApiService } from '../../services/ruleAssignment.service';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import { contestApiService } from '../../services/contest.service';
import { commissionDisputeService } from '../../services/commissionDispute.service';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Group {
  id: string;
  name: string;
  color: string;
  leadId: string | null;
  lead: (PublicUser & { groupId: string | null }) | null;
  members: (PublicUser & { groupId: string | null })[];
}

const inviteSchema = z.object({
  firstName: z.string().min(1, 'Prénom requis'),
  lastName: z.string().min(1, 'Nom requis'),
  email: z.string().email('Email invalide'),
  role: z.enum([UserRole.COMMERCIAL, UserRole.RECRUITER, UserRole.BU_MANAGER]).default(UserRole.COMMERCIAL),
  fixedSalary: z.coerce.number().min(0, 'Le salaire ne peut pas être négatif').default(0),
});

type InviteFormData = z.infer<typeof inviteSchema>;

const currentYear = new Date().getFullYear();

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function formatObjectivePeriod(obj: Objective): string {
  switch (obj.periodType) {
    case 'monthly':  return `${MONTHS[(obj.month ?? 1) - 1]} ${obj.year ?? currentYear}`;
    case 'quarterly': return `T${obj.quarter ?? 1} ${obj.year ?? currentYear}`;
    case 'semester':  return `S${obj.semester ?? 1} ${obj.year ?? currentYear}`;
    case 'annual':   return `Année ${obj.year ?? currentYear}`;
    case 'custom':
      if (obj.startDate && obj.endDate) {
        return `${format(new Date(obj.startDate), 'dd/MM/yy')} → ${format(new Date(obj.endDate), 'dd/MM/yy')}`;
      }
      return 'Période perso.';
    default: return '';
  }
}

/**
 * Collecte tous les objectifs distincts de l'équipe (dédupliqués par label+période).
 * excludeMemberId : on peut exclure le membre en cours d'édition pour ne montrer
 * que les objectifs "des autres".
 */
function collectTemplateObjectives(members: PublicUser[], excludeMemberId?: string): Objective[] {
  const seen = new Set<string>();
  const result: Objective[] = [];
  for (const m of members) {
    if (m.id === excludeMemberId) continue;
    const objs = Array.isArray(m.objectives) ? (m.objectives as Objective[]) : [];
    for (const obj of objs) {
      const key = `${obj.label}|${obj.periodType}|${obj.year ?? ''}|${obj.quarter ?? ''}|${obj.month ?? ''}`;
      if (!seen.has(key) && obj.label) {
        seen.add(key);
        result.push(obj);
      }
    }
  }
  return result;
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

// ─── Modal de résolution de contestation ─────────────────────────────────────
function ResolveDisputeModal({
  dispute,
  onClose,
  onResolved,
}: {
  dispute: CommissionDispute;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [action, setAction] = useState<'accept' | 'reject'>('reject');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deal = dispute.commission?.deal;
  const originalCommissionAmount = dispute.commission?.amount ?? 0;
  const [dealTitle, setDealTitle] = useState(deal?.title ?? '');
  const [dealClient, setDealClient] = useState(deal?.clientName ?? '');
  const [dealAmount, setDealAmount] = useState(deal?.amount ?? 0);
  const [dealType, setDealType] = useState(deal?.dealType ?? '');
  const [dealNotes, setDealNotes] = useState(deal?.notes ?? '');
  const [commissionAmount, setCommissionAmount] = useState(originalCommissionAmount);
  const [commissionManualOverride, setCommissionManualOverride] = useState(false);

  const hasDealChanges = deal && (
    dealTitle !== deal.title ||
    dealClient !== (deal.clientName ?? '') ||
    dealAmount !== deal.amount ||
    dealType !== (deal.dealType ?? '') ||
    dealNotes !== (deal.notes ?? '')
  );

  const hasCommissionOverride = commissionManualOverride && commissionAmount !== originalCommissionAmount;
  const dealAmountChanged = deal && dealAmount !== deal.amount;

  const handleSubmit = async () => {
    if (!response.trim()) {
      setError('Une réponse est requise.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let dealUpdates: Record<string, unknown> | undefined;
      if (action === 'accept' && hasDealChanges && deal) {
        dealUpdates = {};
        if (dealTitle !== deal.title) dealUpdates.title = dealTitle;
        if (dealClient !== (deal.clientName ?? '')) dealUpdates.clientName = dealClient || null;
        if (dealAmount !== deal.amount) dealUpdates.amount = dealAmount;
        if (dealType !== (deal.dealType ?? '')) dealUpdates.dealType = dealType || null;
        if (dealNotes !== (deal.notes ?? '')) dealUpdates.notes = dealNotes || null;
      }
      const commOverride = (action === 'accept' && hasCommissionOverride) ? commissionAmount : undefined;
      await commissionDisputeService.resolve(
        dispute.id,
        action,
        response.trim(),
        dealUpdates as Parameters<typeof commissionDisputeService.resolve>[3],
        commOverride,
      );
      onResolved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Résoudre la contestation</h3>

          {dispute.raiser && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                {dispute.raiser.firstName[0]}{dispute.raiser.lastName[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{dispute.raiser.firstName} {dispute.raiser.lastName}</p>
                <p className="text-xs text-gray-400">{dispute.raiser.email}</p>
              </div>
            </div>
          )}

          <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Motif de la contestation</p>
            <p className="text-sm text-gray-700 italic">"{dispute.reason}"</p>
          </div>

          {deal && (
            <div className="bg-blue-50 rounded-lg px-4 py-3 mb-4">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Vente concernée</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-500">Nom : </span><span className="font-medium text-gray-900">{deal.title}</span></div>
                <div><span className="text-gray-500">Client : </span><span className="font-medium text-gray-900">{deal.clientName ?? '—'}</span></div>
                <div><span className="text-gray-500">Montant : </span><span className="font-medium text-gray-900">{formatEur(deal.amount)}</span></div>
                <div><span className="text-gray-500">Type : </span><span className="font-medium text-gray-900">{deal.dealType ?? '—'}</span></div>
                {deal.closedAt && (
                  <div><span className="text-gray-500">Clôturée le : </span><span className="font-medium text-gray-900">{format(new Date(deal.closedAt), 'dd MMM yyyy', { locale: fr })}</span></div>
                )}
                {dispute.commission && (
                  <div><span className="text-gray-500">Commission : </span><span className="font-medium text-gray-900">{formatEur(dispute.commission.amount)}</span></div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setAction('accept')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                action === 'accept' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >Accepter</button>
            <button
              onClick={() => setAction('reject')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                action === 'reject' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >Rejeter</button>
          </div>

          {action === 'accept' && deal && (
            <div className="border border-green-200 bg-green-50 rounded-lg p-4 mb-4 space-y-4">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Modifier la vente (optionnel)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la vente</label>
                  <input type="text" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                  <input type="text" value={dealClient} onChange={(e) => setDealClient(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Montant de la vente</label>
                  <input type="number" value={dealAmount} onChange={(e) => setDealAmount(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                  {dealAmountChanged && !commissionManualOverride && (
                    <p className="text-xs text-green-600 mt-1">La commission sera recalculée automatiquement</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type de deal</label>
                  <input type="text" value={dealType} onChange={(e) => setDealType(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <input type="text" value={dealNotes} onChange={(e) => setDealNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
              </div>
              <div className="border-t border-green-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Commission actuelle : {formatEur(originalCommissionAmount)}</p>
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={commissionManualOverride}
                      onChange={(e) => { setCommissionManualOverride(e.target.checked); if (!e.target.checked) setCommissionAmount(originalCommissionAmount); }}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-400" />
                    Modifier la commission manuellement
                  </label>
                </div>
                {commissionManualOverride && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nouveau montant de commission</label>
                    <input type="number" step="0.01" value={commissionAmount} onChange={(e) => setCommissionAmount(Number(e.target.value))}
                      className="w-48 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                    {hasCommissionOverride && (
                      <p className="text-xs text-green-600 mt-1 font-medium">Commission modifiée de {formatEur(originalCommissionAmount)} à {formatEur(commissionAmount)}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="block text-sm font-medium text-gray-700 mb-1">
            Réponse au commercial <span className="text-red-500">*</span>
          </label>
          <textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            placeholder="Expliquez votre décision au commercial..." />

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

          <div className="flex gap-3 justify-end mt-5">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Annuler</Button>
            <Button size="sm" variant={action === 'accept' ? 'primary' : 'danger'} loading={loading} onClick={() => void handleSubmit()}>
              {action === 'accept' ? 'Accepter' : 'Rejeter'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Page principale
// ============================================================
export function TeamPage() {
  const { user } = useAuthStore();
  const isTeamLead = user?.role === UserRole.TEAM_LEAD;
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<PublicUser | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);

  // Modale d'édition individuelle
  const [memberToEdit, setMemberToEdit] = useState<PublicUser | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editSalary, setEditSalary] = useState('');
  const [editObjectives, setEditObjectives] = useState<Objective[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Règles de commission dans la modale d'édition
  const [memberRuleAssignments, setMemberRuleAssignments] = useState<RuleAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [libraryRules, setLibraryRules] = useState<CommissionRuleWithCount[]>([]);
  const [assignRuleId, setAssignRuleId] = useState('');
  const [assignType, setAssignType] = useState<AssigneeType>(AssigneeType.INDIVIDUAL);
  const [assignStartDate, setAssignStartDate] = useState('');
  const [assignEndDate, setAssignEndDate] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null);

  // Picker de réutilisation d'objectifs
  const [showEditPicker, setShowEditPicker] = useState(false);

  // Wizard modal pour créer/éditer un objectif
  const [wizardObjective, setWizardObjective] = useState<Objective | null>(null);
  const [showObjectiveWizard, setShowObjectiveWizard] = useState(false);

  // Concours du membre en édition
  const [memberContests, setMemberContests] = useState<Contest[]>([]);
  const [loadingContests, setLoadingContests] = useState(false);

  // Modale "Créer un concours personnel"
  const [showCreateContestModal, setShowCreateContestModal] = useState(false);
  const [contestName, setContestName] = useState('');
  const [contestPrize, setContestPrize] = useState('');
  const [contestMetric, setContestMetric] = useState<ContestMetric>(ContestMetric.REVENUE);
  const [contestStart, setContestStart] = useState('');
  const [contestEnd, setContestEnd] = useState('');
  const [creatingContest, setCreatingContest] = useState(false);
  const [createContestError, setCreateContestError] = useState<string | null>(null);

  // Modale "Voir tout"
  const [showAllModal, setShowAllModal] = useState(false);

  // ── Contestations intégrées ──
  const [disputes, setDisputes] = useState<CommissionDispute[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(true);
  const [disputeFilter, setDisputeFilter] = useState<DisputeStatus | 'ALL'>('OPEN');
  const [resolveModal, setResolveModal] = useState<CommissionDispute | null>(null);
  const [expandedDisputeIds, setExpandedDisputeIds] = useState<Set<string>>(new Set());

  // Drawer synthétique (vue membre)
  const [memberToView, setMemberToView] = useState<PublicUser | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
  });

  const loadTeam = async () => {
    try {
      const [teamRes, groupsRes] = await Promise.all([
        api.get<{ success: true; data: PublicUser[] }>('/auth/team'),
        api.get<{ success: true; data: Group[] }>('/groups').catch(() => ({ data: { data: [] as Group[] } })),
      ]);
      setMembers(teamRes.data.data);
      setGroups(groupsRes.data.data);
    } catch {
      // silencieux
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTeam(); }, []);

  // ── Chargement des contestations ──
  const loadDisputes = async () => {
    setDisputesLoading(true);
    try {
      const data = await commissionDisputeService.listByTenant(
        disputeFilter === 'ALL' ? undefined : disputeFilter,
      );
      setDisputes(data);
    } finally {
      setDisputesLoading(false);
    }
  };

  useEffect(() => { void loadDisputes(); }, [disputeFilter]);

  const openDisputeCount = disputes.filter((d) => d.status === 'OPEN').length;

  // ── Édition infos personnelles (nom/salaire uniquement) ────
  const openEditModal = (member: PublicUser) => {
    setMemberToEdit(member);
    setEditFirstName(member.firstName);
    setEditLastName(member.lastName);
    setEditSalary(String(member.fixedSalary ?? 0));
    setEditError(null);
  };

  // ── Drawer synthétique ─────────────────────────────────────
  const openDrawer = (member: PublicUser) => {
    setMemberToView(member);
    setExpandedSections(new Set());
    setEditObjectives(Array.isArray(member.objectives) ? member.objectives : []);
    setEditError(null);
    setShowEditPicker(false);
    setMemberRuleAssignments([]);
    setMemberContests([]);
    void loadMemberAssignments(member.id);
    void loadMemberContests(member.id);
  };

  const closeDrawer = () => setMemberToView(null);

  const toggleDrawerSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const onSaveObjectives = async () => {
    if (!memberToView) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await api.patch(`/auth/team/${memberToView.id}`, {
        firstName: memberToView.firstName,
        lastName: memberToView.lastName,
        fixedSalary: memberToView.fixedSalary ?? 0,
        objectives: editObjectives,
      });
      setMemberToView((prev) => prev ? { ...prev, objectives: editObjectives } : null);
      await loadTeam();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setEditError(msg ?? 'Impossible de sauvegarder les objectifs');
    } finally {
      setEditLoading(false);
    }
  };

  const loadMemberContests = async (userId: string) => {
    setLoadingContests(true);
    try {
      const all = await contestApiService.getAll();
      const memberGroupName = groups.find((g) => g.members.some((m) => m.id === userId))?.name ?? null;
      const relevant = all.filter((c) => {
        if (c.status !== ContestStatus.ACTIVE) return false;
        if (c.scope === RuleScope.GLOBAL) return true;
        if (c.scope === RuleScope.INDIVIDUAL) return (c.participantIds as string[]).includes(userId);
        if (c.scope === RuleScope.TEAM && memberGroupName) return c.teamName === memberGroupName;
        return false;
      });
      setMemberContests(relevant);
    } catch {
      setMemberContests([]);
    } finally {
      setLoadingContests(false);
    }
  };

  const openCreateContestModal = () => {
    if (!memberToView) return;
    setContestName(`Concours — ${memberToView.firstName} ${memberToView.lastName}`);
    setContestPrize('');
    setContestMetric(ContestMetric.REVENUE);
    setContestStart('');
    setContestEnd('');
    setCreateContestError(null);
    setShowCreateContestModal(true);
  };

  const onCreatePersonalContest = async () => {
    if (!memberToView) return;
    if (!contestName.trim() || !contestPrize.trim() || !contestStart || !contestEnd) {
      setCreateContestError('Veuillez remplir tous les champs');
      return;
    }
    if (new Date(contestEnd) <= new Date(contestStart)) {
      setCreateContestError('La date de fin doit être après la date de début');
      return;
    }
    setCreatingContest(true);
    setCreateContestError(null);
    try {
      await contestApiService.create({
        name: contestName.trim(),
        description: '',
        prize: contestPrize.trim(),
        metric: contestMetric,
        scope: RuleScope.INDIVIDUAL,
        participantIds: [memberToView.id],
        periodStart: new Date(contestStart).toISOString(),
        periodEnd: new Date(contestEnd).toISOString(),
      });
      setShowCreateContestModal(false);
      await loadMemberContests(memberToView.id);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setCreateContestError(msg ?? 'Impossible de créer le concours');
    } finally {
      setCreatingContest(false);
    }
  };

  const loadMemberAssignments = async (userId: string) => {
    setLoadingAssignments(true);
    try {
      const data = await ruleAssignmentApiService.getForUser(userId);
      setMemberRuleAssignments(data);
    } catch {
      // silencieux
    } finally {
      setLoadingAssignments(false);
    }
  };

  const openAssignModal = async () => {
    setAssignRuleId('');
    setAssignType(AssigneeType.INDIVIDUAL);
    setAssignStartDate(new Date().toISOString().slice(0, 10));
    setAssignEndDate('');
    setAssignError(null);
    try {
      const rules = await commissionRuleApiService.getAll({ archived: false });
      setLibraryRules(rules);
    } catch {
      setLibraryRules([]);
    }
    setShowAssignModal(true);
  };

  const onAssignRule = async () => {
    if (!memberToView || !assignRuleId) {
      setAssignError('Sélectionnez une règle');
      return;
    }
    setAssignLoading(true);
    setAssignError(null);
    try {
      await ruleAssignmentApiService.assign({
        ruleId: assignRuleId,
        assignedToType: assignType,
        userId: assignType === AssigneeType.INDIVIDUAL ? memberToView.id : null,
        teamName: assignType === AssigneeType.TEAM ? (groups.find((g) => g.members.some((m) => m.id === memberToView.id))?.name ?? null) : null,
        startDate: assignStartDate ? new Date(assignStartDate).toISOString() : undefined,
        endDate: assignEndDate ? new Date(assignEndDate).toISOString() : null,
      });
      setShowAssignModal(false);
      await loadMemberAssignments(memberToView.id);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setAssignError(msg ?? 'Impossible d\'assigner la règle');
    } finally {
      setAssignLoading(false);
    }
  };

  const onRemoveAssignment = async (assignmentId: string) => {
    if (!memberToView) return;
    setRemovingAssignmentId(assignmentId);
    try {
      await ruleAssignmentApiService.deactivate(assignmentId);
      await loadMemberAssignments(memberToView.id);
    } finally {
      setRemovingAssignmentId(null);
    }
  };

  const onSaveEdit = async () => {
    if (!memberToEdit) return;
    const salary = parseFloat(editSalary);
    if (isNaN(salary) || salary < 0) { setEditError('Veuillez entrer un montant de salaire valide'); return; }
    if (!editFirstName.trim() || !editLastName.trim()) { setEditError('Le prénom et le nom sont requis'); return; }
    setEditLoading(true);
    setEditError(null);
    try {
      await api.patch(`/auth/team/${memberToEdit.id}`, {
        firstName: editFirstName.trim(),
        lastName: editLastName.trim(),
        fixedSalary: salary,
        objectives: memberToEdit.objectives ?? [],
      });
      setMemberToEdit(null);
      await loadTeam();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setEditError(msg ?? 'Impossible de sauvegarder les modifications');
    } finally {
      setEditLoading(false);
    }
  };

  // Ouvrir le wizard pour créer un nouvel objectif
  const addObjective = () => {
    setWizardObjective(null);
    setShowObjectiveWizard(true);
  };

  // Ouvrir le wizard pour éditer un objectif existant
  const editObjective = (obj: Objective) => {
    setWizardObjective(obj);
    setShowObjectiveWizard(true);
  };

  // Callback du wizard : créer ou mettre à jour l'objectif
  const handleWizardSubmit = (objective: Objective) => {
    setEditObjectives((prev) => {
      const existing = prev.find((o) => o.id === objective.id);
      if (existing) {
        return prev.map((o) => o.id === objective.id ? objective : o);
      }
      return [...prev, { ...objective, id: generateId() }];
    });
    setShowObjectiveWizard(false);
    setWizardObjective(null);
  };

  const removeObjective = (id: string) => setEditObjectives((p) => p.filter((o) => o.id !== id));

  /** Copie un objectif existant (nouveau ID) dans la liste d'édition individuelle */
  const pickTemplateForEdit = (tpl: Objective) => {
    setEditObjectives((p) => [...p, { ...tpl, id: generateId() }]);
    setShowEditPicker(false);
  };

  // ── Autres actions ─────────────────────────────────────────
  const onResendInvitation = async (member: PublicUser) => {
    setResendingId(member.id);
    setResendSuccess(null);
    try {
      await authApiService.resendInvitation(member.id);
      setResendSuccess(member.id);
      setTimeout(() => setResendSuccess(null), 3000);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Erreur lors du renvoi';
      alert(`Erreur : ${msg}`);
    } finally {
      setResendingId(null);
    }
  };

  const onDelete = async () => {
    if (!memberToDelete) return;
    setDeletingId(memberToDelete.id);
    try {
      await api.delete(`/auth/team/${memberToDelete.id}`);
      await loadTeam();
    } catch { /* silencieux */ } finally {
      setDeletingId(null);
      setMemberToDelete(null);
    }
  };

  const onInvite = async (data: InviteFormData) => {
    setInviteError(null);
    try {
      await authApiService.inviteCommercial({ ...data, fixedSalary: data.fixedSalary });
      setInviteSuccess(`Invitation envoyée à ${data.email}`);
      reset();
      setTimeout(() => { setShowInviteModal(false); setInviteSuccess(null); }, 2000);
      await loadTeam();
    } catch (err) {
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Impossible d\'envoyer l\'invitation';
      setInviteError(message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }


  return (
    <div className="space-y-6">
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mon équipe</h1>
          <p className="text-gray-500 mt-1">
            {isTeamLead
              ? 'Gérez les membres de votre équipe'
              : 'Double-cliquez sur un membre dans l\'organigramme pour ouvrir sa fiche'}
          </p>
        </div>
        <Button onClick={() => setShowInviteModal(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Inviter un collaborateur
        </Button>
      </div>

      {/* ── Tableau de l'équipe (max 4) ── */}
      <Card padding="none">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Membre</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Rôle</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Statut</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Salaire fixe</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Objectifs</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Depuis</th>
              <th className="py-3 px-6" />
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">
                <p className="font-medium">Aucun membre pour l'instant</p>
                <p className="text-sm mt-1">Invitez votre premier commercial ci-dessus</p>
              </td></tr>
            ) : members.slice(0, 4).map((member) => {
              const objectives = Array.isArray(member.objectives) ? member.objectives : [];
              return (
                <tr key={member.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary-700 font-semibold text-xs">{member.firstName[0]}{member.lastName[0]}</span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{member.firstName} {member.lastName}</p>
                        <p className="text-xs text-gray-400">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    {member.role === UserRole.MANAGER && <Badge variant="indigo">Manager</Badge>}
                    {(member.role === UserRole.TEAM_LEAD || member.role === UserRole.BU_MANAGER) && <Badge variant="purple">Resp. de secteur</Badge>}
                    {member.role === UserRole.RECRUITER && <Badge variant="green">Recruteur</Badge>}
                    {member.role === UserRole.COMMERCIAL && <Badge variant="blue">Commercial</Badge>}
                  </td>
                  <td className="py-4 px-6">
                    {member.isActive ? <Badge variant="green">Actif</Badge> : <Badge variant="gray">Inactif</Badge>}
                    {!member.emailVerified && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        <span className="text-xs text-yellow-600">Invitation en attente</span>
                        {resendSuccess === member.id
                          ? <span className="text-xs text-green-600 font-medium">Invitation renvoyée ✓</span>
                          : <button onClick={() => void onResendInvitation(member)} disabled={resendingId === member.id} className="text-xs text-primary-600 hover:underline disabled:opacity-50 text-left">
                              {resendingId === member.id ? 'Envoi...' : 'Relancer l\'invitation'}
                            </button>}
                      </div>
                    )}
                  </td>
                  <td className="py-4 px-6 text-gray-700 font-medium">
                    {member.fixedSalary ? `${member.fixedSalary.toLocaleString('fr-FR')} €` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-4 px-6">
                    {objectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).length === 0
                      ? <span className="text-gray-400 text-xs">Aucun objectif</span>
                      : <div className="flex flex-wrap gap-1">
                          {objectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).slice(0, 2).map((obj) => (
                            <span key={obj.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                              {obj.label || 'Objectif'} · {obj.target.toLocaleString('fr-FR')} {obj.unit} · {formatObjectivePeriod(obj)}
                              {obj.bonus?.enabled && <span className="ml-1 text-green-600 font-bold">+{obj.bonus.value}{obj.bonus.type === 'percentage' ? '%' : '€'}</span>}
                            </span>
                          ))}
                          {objectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).length > 2 && <span className="text-xs text-gray-400">+{objectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).length - 2}</span>}
                        </div>}
                  </td>
                  <td className="py-4 px-6 text-gray-500">{format(new Date(member.createdAt), 'dd MMM yyyy', { locale: fr })}</td>
                  <td className="py-4 px-6 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isTeamLead && (
                        <button onClick={() => openDrawer(member)} className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Voir / modifier">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                      )}
                      <button onClick={() => setMemberToDelete(member)} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Supprimer">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {members.length > 4 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">{members.length - 4} collaborateur{members.length - 4 > 1 ? 's' : ''} masqué{members.length - 4 > 1 ? 's' : ''}</p>
            <button
              onClick={() => setShowAllModal(true)}
              className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
            >
              Voir tous les collaborateurs ({members.length})
            </button>
          </div>
        )}
      </Card>


      {/* ── Organigramme (MANAGER uniquement, pas pour le Responsable de secteur) ── */}
      {!isTeamLead && members.length > 0 && (() => {
        const assignedIds = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
        const leadIds = new Set(groups.map((g) => g.leadId).filter(Boolean) as string[]);
        const unassigned = members
          .filter((m) => !assignedIds.has(m.id) && !leadIds.has(m.id))
          .map((m) => ({ ...m, groupId: null as string | null }));
        return <Card><OrgChart groups={groups} unassigned={unassigned} onRefresh={() => void loadTeam()} onMemberClick={openDrawer} /></Card>;
      })()}

      {/* ================================================================
          Section Contestations
      ================================================================ */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Contestations</h2>
              {disputeFilter === 'OPEN' && openDisputeCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                  {openDisputeCount} en attente
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">Gérez les contestations de vos commerciaux</p>
          </div>
        </div>

        {/* Filtres */}
        <div className="px-6 pt-4 flex gap-2">
          {(['ALL', 'OPEN', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setDisputeFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                disputeFilter === s
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s === 'ALL' ? 'Toutes' : s === 'OPEN' ? 'En attente' : s === 'RESOLVED_ACCEPTED' ? 'Acceptée' : 'Rejetée'}
            </button>
          ))}
        </div>

        {/* Contenu */}
        <div className="px-6 py-4">
          {disputesLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
            </div>
          ) : disputes.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium text-sm">Aucune contestation</p>
              <p className="text-xs mt-1">
                {disputeFilter === 'OPEN' ? 'Tout est traité !' : 'Aucune contestation pour ce filtre.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Commercial</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Motif</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Date</th>
                    {disputeFilter !== 'OPEN' && (
                      <th className="text-left py-3 px-2 font-medium text-gray-500">Réponse manager</th>
                    )}
                    <th className="text-right py-3 px-2 font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.map((dispute) => {
                    const deal = dispute.commission?.deal;
                    const raiserName = dispute.raiser
                      ? `${dispute.raiser.firstName} ${dispute.raiser.lastName}`
                      : dispute.raisedBy;
                    const isExpanded = expandedDisputeIds.has(dispute.id);
                    const showResp = disputeFilter !== 'OPEN';
                    return (
                      <React.Fragment key={dispute.id}>
                        <tr
                          className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/50 transition-colors"
                          onClick={() => setExpandedDisputeIds((prev) => {
                            const next = new Set(prev);
                            next.has(dispute.id) ? next.delete(dispute.id) : next.add(dispute.id);
                            return next;
                          })}
                        >
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              <svg
                                className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="font-medium text-gray-900">{raiserName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-gray-600 max-w-xs">
                            <p className="truncate max-w-[220px]" title={dispute.reason}>{dispute.reason}</p>
                          </td>
                          <td className="py-3 px-2">
                            <Badge variant={dispute.status === 'OPEN' ? 'yellow' : dispute.status === 'RESOLVED_ACCEPTED' ? 'green' : 'red'}>
                              {dispute.status === 'OPEN' ? 'En attente' : dispute.status === 'RESOLVED_ACCEPTED' ? 'Acceptée' : 'Rejetée'}
                            </Badge>
                          </td>
                          <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">
                            {format(new Date(dispute.createdAt), 'dd MMM yyyy', { locale: fr })}
                          </td>
                          {showResp && (
                            <td className="py-3 px-2 text-gray-500 text-xs max-w-[200px]">
                              {dispute.managerResponse
                                ? <span title={dispute.managerResponse} className="truncate block max-w-[180px]">{dispute.managerResponse}</span>
                                : <span className="text-gray-300">&mdash;</span>}
                            </td>
                          )}
                          <td className="py-3 px-2 text-right">
                            {dispute.status === 'OPEN' && (
                              <Button size="sm" onClick={(e) => { e.stopPropagation(); setResolveModal(dispute); }}>
                                Traiter
                              </Button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && deal && (
                          <tr className="bg-gray-50/70">
                            <td colSpan={showResp ? 6 : 5} className="px-6 py-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div>
                                  <span className="text-gray-400 block">Vente</span>
                                  <span className="font-medium text-gray-800">{deal.title}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400 block">Client</span>
                                  <span className="font-medium text-gray-800">{deal.clientName ?? '—'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400 block">Montant</span>
                                  <span className="font-medium text-gray-800">{formatEur(deal.amount)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400 block">Commission</span>
                                  <span className="font-medium text-gray-800">
                                    {dispute.commission ? formatEur(dispute.commission.amount) : '—'}
                                  </span>
                                </div>
                                {deal.dealType && (
                                  <div>
                                    <span className="text-gray-400 block">Type</span>
                                    <span className="font-medium text-gray-800">{deal.dealType}</span>
                                  </div>
                                )}
                                {deal.closedAt && (
                                  <div>
                                    <span className="text-gray-400 block">Date de clôture</span>
                                    <span className="font-medium text-gray-800">
                                      {format(new Date(deal.closedAt), 'dd MMM yyyy', { locale: fr })}
                                    </span>
                                  </div>
                                )}
                                {dispute.commission?.rule && (
                                  <div>
                                    <span className="text-gray-400 block">Règle</span>
                                    <span className="font-medium text-gray-800">{dispute.commission.rule.name}</span>
                                  </div>
                                )}
                              </div>
                              {dispute.managerResponse && dispute.status !== 'OPEN' && (
                                <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                                  <p className="text-xs font-semibold text-yellow-700 mb-0.5">Réponse du manager</p>
                                  <p className="text-xs text-yellow-800">{dispute.managerResponse}</p>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Modale de résolution de contestation */}
      {resolveModal && (
        <ResolveDisputeModal
          dispute={resolveModal}
          onClose={() => setResolveModal(null)}
          onResolved={() => {
            setResolveModal(null);
            void loadDisputes();
          }}
        />
      )}

      {/* ================================================================
          Popup : Vue synthétique d'un membre
      ================================================================ */}
      {memberToView && (() => {
        const activeRules = memberRuleAssignments.filter((a) => a.isActive);
        const isExpCommissions = expandedSections.has('commissions');
        const isExpObjectifs   = expandedSections.has('objectifs');
        const isExpConcours    = expandedSections.has('concours');

        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDrawer} />

            {/* Popup */}
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col z-10 max-h-[85vh]">

              {/* ── En-tête membre ── */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-700 font-semibold text-sm">{memberToView.firstName[0]}{memberToView.lastName[0]}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{memberToView.firstName} {memberToView.lastName}</p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">

                    {memberToView.role === UserRole.MANAGER && <Badge variant="indigo">Manager</Badge>}
                    {(memberToView.role === UserRole.TEAM_LEAD || memberToView.role === UserRole.BU_MANAGER) && <Badge variant="purple">Resp. de secteur</Badge>}
                    {memberToView.role === UserRole.RECRUITER && <Badge variant="green">Recruteur</Badge>}
                    {memberToView.role === UserRole.COMMERCIAL && <Badge variant="blue">Commercial</Badge>}
                    {memberToView.isActive ? <Badge variant="green">Actif</Badge> : <Badge variant="gray">Inactif</Badge>}
                    {memberToView.fixedSalary ? (
                      <span className="text-xs text-gray-400">{memberToView.fixedSalary.toLocaleString('fr-FR')} €/mois</span>
                    ) : null}
                  </div>
                </div>
                <button onClick={closeDrawer} className="ml-auto flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* ── Corps : 3 sections ── */}
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

                {/* ── Section Commissions ── */}
                <div>
                  <button
                    onClick={() => toggleDrawerSection('commissions')}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-blue-100 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">Commissions</span>
                      {activeRules.length > 0 && (
                        <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">{activeRules.length}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); void openAssignModal(); }}
                        className="text-xs font-medium text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-md transition-colors"
                      >
                        + Assigner
                      </button>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpCommissions ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  <div className="px-5 pb-3.5">
                    {loadingAssignments ? (
                      <div className="flex justify-center py-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" /></div>
                    ) : !isExpCommissions ? (
                      activeRules.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucune règle de commission assignée</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {activeRules.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">
                              {a.rule.name}
                              {a.rule.dealType && <span className="opacity-60">· {a.rule.dealType}</span>}
                            </span>
                          ))}
                        </div>
                      )
                    ) : (
                      activeRules.length === 0 ? (
                        <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                          <p className="text-sm text-gray-400">Aucune règle assignée</p>
                          <p className="text-xs text-gray-300 mt-0.5">Cliquez sur "+ Assigner" pour en ajouter</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {activeRules.map((assignment) => (
                            <div key={assignment.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-900">{assignment.rule.name}</span>
                                  {assignment.rule.dealType && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">{assignment.rule.dealType}</span>
                                  )}
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${assignment.assignedToType === AssigneeType.INDIVIDUAL ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                    {assignment.assignedToType === AssigneeType.INDIVIDUAL ? 'Directe' : `Équipe${assignment.teamName ? ` · ${assignment.teamName}` : ''}`}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Depuis le {format(new Date(assignment.startDate), 'dd MMM yyyy', { locale: fr })}
                                  {assignment.endDate && ` → ${format(new Date(assignment.endDate), 'dd MMM yyyy', { locale: fr })}`}
                                </p>
                              </div>
                              <button
                                onClick={() => void onRemoveAssignment(assignment.id)}
                                disabled={removingAssignmentId === assignment.id}
                                className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                              >
                                {removingAssignmentId === assignment.id ? '...' : 'Retirer'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>

                {/* ── Section Objectifs ── */}
                <div>
                  <button
                    onClick={() => toggleDrawerSection('objectifs')}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">Objectifs</span>
                      {editObjectives.length > 0 && (
                        <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">{editObjectives.length}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isExpObjectifs && collectTemplateObjectives(members, memberToView.id).length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowEditPicker((v) => !v); }}
                          className="text-xs font-medium text-gray-500 hover:bg-gray-100 px-2 py-1 rounded-md transition-colors border border-gray-200"
                        >
                          Réutiliser
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isExpObjectifs) setExpandedSections((prev) => { const n = new Set(prev); n.add('objectifs'); return n; });
                          addObjective();
                        }}
                        className="text-xs font-medium text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors"
                      >
                        + Nouveau
                      </button>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpObjectifs ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  <div className="px-5 pb-3.5">
                    {!isExpObjectifs ? (
                      editObjectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucun objectif défini</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {editObjectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).map((obj) => (
                            <span key={obj.id} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full border border-indigo-100">
                              {obj.label || 'Objectif'} · {obj.target.toLocaleString('fr-FR')} {obj.unit} · {formatObjectivePeriod(obj)}
                              {obj.bonus?.enabled && <span className="text-green-600 ml-0.5 font-semibold">+{obj.bonus.value}{obj.bonus.type === 'percentage' ? '%' : '€'}</span>}
                            </span>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="space-y-3">
                        {showEditPicker && (
                          <ObjectivePicker
                            objectives={collectTemplateObjectives(members, memberToView.id)}
                            onPick={pickTemplateForEdit}
                            onClose={() => setShowEditPicker(false)}
                          />
                        )}
                        {editObjectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).length === 0 && !showEditPicker ? (
                          <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                            <p className="text-sm text-gray-400">Aucun objectif défini</p>
                            <p className="text-xs text-gray-300 mt-1">Cliquez sur « + Nouveau » pour créer un objectif</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {editObjectives.filter((obj) => !(obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId)).map((obj) => {
                              const isRecurrent = !!obj.parentObjectiveId;
                              const isTemplate = obj.recurrence && obj.recurrence !== 'none' && !obj.parentObjectiveId;
                              const effectiveBonusMode = obj.bonusMode ?? (obj.bonus?.enabled ? 'simple' : 'none');
                              const hasTiers = effectiveBonusMode === 'tiered' && obj.bonusTiers && obj.bonusTiers.length > 0;

                              return (
                                <div
                                  key={obj.id}
                                  className="group relative border border-gray-200 rounded-xl p-3.5 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer"
                                  onClick={() => editObjective(obj)}
                                >
                                  {/* Bouton supprimer */}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); removeObjective(obj.id); }}
                                    className="absolute top-2.5 right-2.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                    title="Supprimer cet objectif"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>

                                  {/* Ligne 1 : Nom + badges */}
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{obj.label || 'Objectif sans nom'}</p>
                                    {isRecurrent && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium flex-shrink-0">🔁 Récurrent</span>
                                    )}
                                    {isTemplate && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-500 font-medium flex-shrink-0">Template</span>
                                    )}
                                  </div>

                                  {/* Ligne 2 : Détails */}
                                  <div className="flex items-center gap-3 text-xs text-gray-500">
                                    {/* Période */}
                                    <span className="inline-flex items-center gap-1">
                                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      {formatObjectivePeriod(obj)}
                                    </span>

                                    <span className="text-gray-300">·</span>

                                    {/* Cible */}
                                    <span className="font-semibold text-gray-700">
                                      {obj.target.toLocaleString('fr-FR')} {obj.unit}
                                    </span>

                                    {/* Prime */}
                                    {effectiveBonusMode !== 'none' && (
                                      <>
                                        <span className="text-gray-300">·</span>
                                        <span className="text-green-600 font-medium">
                                          {hasTiers
                                            ? `${obj.bonusTiers!.length} palier${obj.bonusTiers!.length > 1 ? 's' : ''}`
                                            : obj.bonus?.type === 'percentage'
                                              ? `+${obj.bonus.value}% si dépassé`
                                              : `+${obj.bonus?.value?.toLocaleString('fr-FR')}€`
                                          }
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Indicateur cliquable */}
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 group-hover:text-indigo-400 transition-colors opacity-0 group-hover:opacity-100">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {editError && <p className="text-sm text-red-600 mt-2">{editError}</p>}
                        <button
                          onClick={() => void onSaveObjectives()}
                          disabled={editLoading}
                          className="w-full py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 mt-2"
                        >
                          {editLoading ? 'Enregistrement...' : 'Enregistrer les objectifs'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Modale Wizard pour créer/éditer un objectif */}
                  <Modal
                    isOpen={showObjectiveWizard}
                    onClose={() => { setShowObjectiveWizard(false); setWizardObjective(null); }}
                    title={wizardObjective ? `Modifier « ${wizardObjective.label || 'Objectif'} »` : 'Nouvel objectif'}
                    size="lg"
                  >
                    <ObjectiveWizard
                      initialObjective={wizardObjective ?? undefined}
                      onSubmit={handleWizardSubmit}
                      onCancel={() => { setShowObjectiveWizard(false); setWizardObjective(null); }}
                      submitLabel={wizardObjective ? "Enregistrer les modifications" : "Ajouter l'objectif"}
                    />
                  </Modal>
                </div>

                {/* ── Section Concours ── */}
                <div>
                  <button
                    onClick={() => toggleDrawerSection('concours')}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-amber-100 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                        </svg>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">Concours</span>
                      {memberContests.length > 0 && (
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">{memberContests.length}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openCreateContestModal(); }}
                        className="text-xs font-medium text-amber-600 hover:bg-amber-50 px-2 py-1 rounded-md transition-colors"
                      >
                        + Créer
                      </button>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpConcours ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  <div className="px-5 pb-3.5">
                    {loadingContests ? (
                      <div className="flex justify-center py-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-amber-500" /></div>
                    ) : !isExpConcours ? (
                      memberContests.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucun concours actif</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {memberContests.map((c) => (
                            <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-100">
                              🏆 {c.prize} · fin {format(new Date(c.periodEnd), 'dd MMM', { locale: fr })}
                            </span>
                          ))}
                        </div>
                      )
                    ) : (
                      memberContests.length === 0 ? (
                        <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                          <p className="text-sm text-gray-400">Aucun concours en cours</p>
                          <p className="text-xs text-gray-300 mt-0.5">Créez un concours personnel via "+ Créer"</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {memberContests.map((c) => (
                            <div key={c.id} className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                              <span className="text-lg flex-shrink-0">🏆</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {c.scope === RuleScope.GLOBAL ? 'Toute l\'équipe' : c.scope === RuleScope.TEAM ? `Équipe · ${c.teamName ?? ''}` : 'Personnel'}
                                  {' · '}{c.metric === ContestMetric.REVENUE ? 'CA (€)' : 'Deals signés'}
                                  {' · '}jusqu'au {format(new Date(c.periodEnd), 'dd MMM yyyy', { locale: fr })}
                                </p>
                              </div>
                              <div className="flex-shrink-0 text-right">
                                <p className="text-xs font-semibold text-amber-700">🎁 {c.prize}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* ── Pied ── */}
              <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={() => { closeDrawer(); openEditModal(memberToView); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Modifier les infos personnelles
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================================
          Modal : Supprimer un collaborateur
      ================================================================ */}
      <Modal isOpen={!!memberToDelete} onClose={() => setMemberToDelete(null)} title="Supprimer le collaborateur">
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
              <span className="text-primary-700 font-semibold text-sm">{memberToDelete?.firstName[0]}{memberToDelete?.lastName[0]}</span>
            </div>
            <div>
              <p className="font-medium text-gray-900">{memberToDelete?.firstName} {memberToDelete?.lastName}</p>
              <p className="text-sm text-gray-500">{memberToDelete?.email}</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">Ce collaborateur sera retiré de votre équipe. Vous pourrez le réinviter ultérieurement.</p>
          <div className="flex gap-3">
            <Button variant="danger" loading={!!deletingId} onClick={() => void onDelete()} className="flex-1">Supprimer</Button>
            <Button type="button" variant="secondary" onClick={() => setMemberToDelete(null)}>Annuler</Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Modal : Modifier les infos personnelles (nom / salaire)
      ================================================================ */}
      <Modal isOpen={!!memberToEdit} onClose={() => setMemberToEdit(null)} title="Modifier les infos personnelles" size="md">
        {memberToEdit && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <span className="text-primary-700 font-semibold text-sm">
                  {(editFirstName[0] ?? memberToEdit.firstName[0])}{(editLastName[0] ?? memberToEdit.lastName[0])}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-900">{memberToEdit.firstName} {memberToEdit.lastName}</p>
                <p className="text-sm text-gray-500">{memberToEdit.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Prénom</label>
                <input type="text" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nom</label>
                <input type="text" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={memberToEdit.email} disabled className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400 bg-gray-50 cursor-not-allowed" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Salaire fixe mensuel (€)</label>
              <div className="relative">
                <input type="number" min="0" step="0.01" value={editSalary} onChange={(e) => setEditSalary(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">€</span>
              </div>
            </div>

            {editError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-600">{editError}</p></div>}

            <div className="flex gap-3">
              <Button loading={editLoading} onClick={() => void onSaveEdit()} className="flex-1">Enregistrer</Button>
              <Button type="button" variant="secondary" onClick={() => setMemberToEdit(null)}>Annuler</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================================================================
          Modal : Assigner une règle
      ================================================================ */}
      <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assigner une règle de commission" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Règle à assigner</label>
            {libraryRules.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucune règle disponible dans la bibliothèque.</p>
            ) : (
              <select
                value={assignRuleId}
                onChange={(e) => setAssignRuleId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="">-- Sélectionner une règle --</option>
                {libraryRules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}{rule.dealType ? ` (${rule.dealType})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Appliquer à</label>
            <div className="grid grid-cols-2 gap-3">
              <label className={`flex items-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-colors ${assignType === AssigneeType.INDIVIDUAL ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="radio"
                  className="sr-only"
                  checked={assignType === AssigneeType.INDIVIDUAL}
                  onChange={() => setAssignType(AssigneeType.INDIVIDUAL)}
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">Ce commercial</p>
                  <p className="text-xs text-gray-400">Uniquement {memberToView?.firstName}</p>
                </div>
              </label>
              <label className={`flex items-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-colors ${assignType === AssigneeType.TEAM ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="radio"
                  className="sr-only"
                  checked={assignType === AssigneeType.TEAM}
                  onChange={() => setAssignType(AssigneeType.TEAM)}
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">Toute l'équipe</p>
                  <p className="text-xs text-gray-400">
                    {groups.find((g) => g.members.some((m) => m.id === memberToView?.id))?.name ?? 'Groupe non défini'}
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de début</label>
              <input
                type="date"
                value={assignStartDate}
                onChange={(e) => setAssignStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin (optionnel)</label>
              <input
                type="date"
                value={assignEndDate}
                onChange={(e) => setAssignEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          </div>

          {assignError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{assignError}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button loading={assignLoading} onClick={() => void onAssignRule()} className="flex-1">
              Confirmer l'assignation
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowAssignModal(false)}>
              Annuler
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Modal : Créer un concours personnel
      ================================================================ */}
      <Modal isOpen={showCreateContestModal} onClose={() => setShowCreateContestModal(false)} title="Créer un concours personnel" size="md">
        <div className="space-y-4">
          {memberToView && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <span className="text-xl">🏆</span>
              <p className="text-sm text-amber-800">
                Ce concours sera réservé à <strong>{memberToView.firstName} {memberToView.lastName}</strong>
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom du concours</label>
            <input
              type="text"
              value={contestName}
              onChange={(e) => setContestName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lot / Récompense</label>
            <input
              type="text"
              value={contestPrize}
              onChange={(e) => setContestPrize(e.target.value)}
              placeholder="Ex : Bon cadeau 200€, Journée off…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Métrique</label>
            <div className="grid grid-cols-2 gap-3">
              <label className={`flex items-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-colors ${contestMetric === ContestMetric.REVENUE ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}>
                <input type="radio" className="sr-only" checked={contestMetric === ContestMetric.REVENUE} onChange={() => setContestMetric(ContestMetric.REVENUE)} />
                <div><p className="text-sm font-semibold text-gray-800">CA réalisé</p><p className="text-xs text-gray-400">Montant total des deals</p></div>
              </label>
              <label className={`flex items-center gap-2 p-3 border-2 rounded-xl cursor-pointer transition-colors ${contestMetric === ContestMetric.DEAL_COUNT ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}>
                <input type="radio" className="sr-only" checked={contestMetric === ContestMetric.DEAL_COUNT} onChange={() => setContestMetric(ContestMetric.DEAL_COUNT)} />
                <div><p className="text-sm font-semibold text-gray-800">Deals signés</p><p className="text-xs text-gray-400">Nombre de deals</p></div>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de début</label>
              <input type="date" value={contestStart} onChange={(e) => setContestStart(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin</label>
              <input type="date" value={contestEnd} onChange={(e) => setContestEnd(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
            </div>
          </div>

          {createContestError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{createContestError}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button loading={creatingContest} onClick={() => void onCreatePersonalContest()} className="flex-1">Créer le concours</Button>
            <Button type="button" variant="secondary" onClick={() => setShowCreateContestModal(false)}>Annuler</Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Modal : Voir tous les collaborateurs
      ================================================================ */}
      <Modal isOpen={showAllModal} onClose={() => setShowAllModal(false)} title={`Tous les collaborateurs (${members.length})`} size="xl">
        <div className="space-y-2">
          {members.map((member) => {
            const objectives = Array.isArray(member.objectives) ? member.objectives : [];
            return (
              <div key={member.id} className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary-700 font-semibold text-xs">{member.firstName[0]}{member.lastName[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900">{member.firstName} {member.lastName}</p>
                    {member.role === UserRole.MANAGER && <Badge variant="indigo">Manager</Badge>}
                    {(member.role === UserRole.TEAM_LEAD || member.role === UserRole.BU_MANAGER) && <Badge variant="purple">Resp. de secteur</Badge>}
                    {member.role === UserRole.RECRUITER && <Badge variant="green">Recruteur</Badge>}
                    {member.role === UserRole.COMMERCIAL && <Badge variant="blue">Commercial</Badge>}
                    {member.isActive ? <Badge variant="green">Actif</Badge> : <Badge variant="gray">Inactif</Badge>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{member.email}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    {member.fixedSalary ? <span>{member.fixedSalary.toLocaleString('fr-FR')} €/mois</span> : null}
                    {objectives.length > 0 && <span>{objectives.length} objectif{objectives.length > 1 ? 's' : ''}</span>}
                    {!member.emailVerified && <span className="text-yellow-600">Invitation en attente</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setShowAllModal(false); openDrawer(member); }}
                    className="text-xs font-medium text-primary-600 hover:bg-primary-50 px-2 py-1 rounded-md transition-colors"
                  >
                    Voir fiche →
                  </button>
                  <button onClick={() => { setShowAllModal(false); setMemberToDelete(member); }} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Supprimer">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* ================================================================
          Modal : Invitation
      ================================================================ */}
      <Modal isOpen={showInviteModal} onClose={() => { setShowInviteModal(false); setInviteError(null); setInviteSuccess(null); reset(); }} title="Inviter un collaborateur">
        {inviteSuccess
          ? <div className="text-center py-6">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="font-medium text-gray-900">{inviteSuccess}</p>
            </div>
          : <form onSubmit={(e) => void handleSubmit(onInvite)(e)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Prénom" placeholder="Jean" error={errors.firstName?.message} {...register('firstName')} />
                <Input label="Nom" placeholder="Martin" error={errors.lastName?.message} {...register('lastName')} />
              </div>
              <Input label="Email" type="email" placeholder="jean.martin@entreprise.fr" error={errors.email?.message} {...register('email')} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Rôle</label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-colors has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50 border-gray-200">
                    <input type="radio" value={UserRole.COMMERCIAL} {...register('role')} className="sr-only" defaultChecked />
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </div>
                    <div><p className="text-sm font-semibold text-gray-800">Commercial</p><p className="text-xs text-gray-400">Accès à son dashboard</p></div>
                  </label>
                  <label className="flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-colors has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50 border-gray-200">
                    <input type="radio" value={UserRole.RECRUITER} {...register('role')} className="sr-only" />
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                    </div>
                    <div><p className="text-sm font-semibold text-gray-800">Recruteur</p><p className="text-xs text-gray-400">Accès à son dashboard</p></div>
                  </label>
                  <label className="flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-colors has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50 border-gray-200">
                    <input type="radio" value={UserRole.BU_MANAGER} {...register('role')} className="sr-only" />
                    <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                    </div>
                    <div><p className="text-sm font-semibold text-gray-800">Resp. de secteur</p><p className="text-xs text-gray-400">Accès au dashboard manager</p></div>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Salaire fixe mensuel brut</label>
                <div className="relative">
                  <input type="number" min="0" step="0.01" placeholder="2 500" className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" {...register('fixedSalary')} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">€</span>
                </div>
                {errors.fixedSalary && <p className="text-xs text-red-500 mt-1">{errors.fixedSalary.message}</p>}
              </div>
              {inviteError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-600">{inviteError}</p></div>}
              <p className="text-sm text-gray-500">Un email avec un lien d'invitation sera envoyé. Le lien est valable 72 heures.</p>
              <div className="flex gap-3">
                <Button type="submit" loading={isSubmitting} className="flex-1">Envoyer l'invitation</Button>
                <Button type="button" variant="secondary" onClick={() => setShowInviteModal(false)}>Annuler</Button>
              </div>
            </form>}
      </Modal>
    </div>
  );
}

// ============================================================
// Composant ObjectivePicker — bibliothèque de réutilisation
// ============================================================

interface ObjectivePickerProps {
  objectives: Objective[];
  onPick: (obj: Objective) => void;
  onClose: () => void;
}

function ObjectivePicker({ objectives, onPick, onClose }: ObjectivePickerProps) {
  if (objectives.length === 0) return null;
  return (
    <div className="border border-indigo-200 rounded-xl bg-indigo-50/50 p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-indigo-700">Objectifs de l'équipe — cliquez pour l'ajouter</p>
        <button type="button" onClick={onClose} className="text-indigo-300 hover:text-indigo-600 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
        {objectives.map((obj) => (
          <button
            key={`${obj.label}-${obj.periodType}-${obj.year}`}
            type="button"
            onClick={() => onPick(obj)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-white border border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-left group"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{obj.label}</p>
              <p className="text-xs text-gray-400">
                {obj.target.toLocaleString('fr-FR')} {obj.unit} · {formatObjectivePeriod(obj)}
                {obj.bonus?.enabled && (
                  <span className="ml-1.5 text-green-600 font-semibold">
                    +{obj.bonus.value}{obj.bonus.type === 'percentage' ? '%' : '€'} si dépassé
                  </span>
                )}
              </p>
            </div>
            <span className="flex-shrink-0 text-xs font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
              Copier →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}


