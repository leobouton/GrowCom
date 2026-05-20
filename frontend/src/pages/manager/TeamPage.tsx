import { useEffect, useState } from 'react';
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
import type { PublicUser, Objective, ObjectivePeriodType, ObjectiveBonus, ObjectiveBonusMode, ObjectiveBonusTier, ObjectiveRecurrence, RuleAssignment, Contest } from '@shared/types';
import { UserRole, AssigneeType, ContestStatus, ContestMetric, RuleScope } from '@shared/types';
import { ruleAssignmentApiService } from '../../services/ruleAssignment.service';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import { contestApiService } from '../../services/contest.service';
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

export const UNIT_OPTIONS = [
  { value: '€', label: '€ (euros)' },
  { value: 'deals', label: 'Deals signés' },
  { value: '%', label: '% (pourcentage)' },
];

export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const currentYear = new Date().getFullYear();
export const YEARS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeDefaultObjective(): Objective {
  return {
    id: generateId(),
    label: '',
    target: 0,
    unit: '€',
    periodType: 'quarterly',
    quarter: Math.ceil((new Date().getMonth() + 1) / 3),
    year: currentYear,
    bonus: { enabled: false, type: 'percentage', value: 10 },
  };
}

function formatObjectivePeriod(obj: Objective): string {
  switch (obj.periodType) {
    case 'monthly':  return `${MONTHS[(obj.month ?? 1) - 1]} ${obj.year ?? currentYear}`;
    case 'quarterly': return `T${obj.quarter ?? 1} ${obj.year ?? currentYear}`;
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

  const addObjective = () => setEditObjectives((p) => [...p, makeDefaultObjective()]);

  const updateObjective = <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => {
    setEditObjectives((prev) => prev.map((obj) => {
      if (obj.id !== id) return obj;
      const updated = { ...obj, [field]: value };
      if (field === 'periodType') {
        delete updated.month; delete updated.quarter; delete updated.startDate; delete updated.endDate;
        const pt = value as ObjectivePeriodType;
        if (pt === 'monthly')   { updated.month = new Date().getMonth() + 1; updated.year = currentYear; }
        if (pt === 'quarterly') { updated.quarter = Math.ceil((new Date().getMonth() + 1) / 3); updated.year = currentYear; }
        if (pt === 'annual')    { updated.year = currentYear; }
      }
      return updated;
    }));
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
                    {objectives.length === 0
                      ? <span className="text-gray-400 text-xs">Aucun objectif</span>
                      : <div className="flex flex-wrap gap-1">
                          {objectives.slice(0, 2).map((obj) => (
                            <span key={obj.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                              {obj.label || 'Objectif'} · {obj.target.toLocaleString('fr-FR')} {obj.unit} · {formatObjectivePeriod(obj)}
                              {obj.bonus?.enabled && <span className="ml-1 text-green-600 font-bold">+{obj.bonus.value}{obj.bonus.type === 'percentage' ? '%' : '€'}</span>}
                            </span>
                          ))}
                          {objectives.length > 2 && <span className="text-xs text-gray-400">+{objectives.length - 2}</span>}
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
                      editObjectives.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Aucun objectif défini</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {editObjectives.map((obj) => (
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
                        {editObjectives.length === 0 && !showEditPicker ? (
                          <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                            <p className="text-sm text-gray-400">Aucun objectif défini</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {editObjectives.map((obj, i) => (
                              <ObjectiveEditor key={obj.id} obj={obj} index={i} onChange={updateObjective} onRemove={removeObjective} />
                            ))}
                          </div>
                        )}
                        {editError && <p className="text-sm text-red-600">{editError}</p>}
                        <button
                          onClick={() => void onSaveObjectives()}
                          disabled={editLoading}
                          className="w-full py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {editLoading ? 'Enregistrement...' : 'Enregistrer les objectifs'}
                        </button>
                      </div>
                    )}
                  </div>
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

// ============================================================
// Composant ObjectiveEditor (réutilisé pour individuel + masse)
// ============================================================

const PERIOD_TYPE_OPTIONS: { value: ObjectivePeriodType; label: string; description: string }[] = [
  { value: 'monthly',   label: 'Mensuel',     description: 'Un mois précis' },
  { value: 'quarterly', label: 'Trimestriel', description: 'T1, T2, T3 ou T4' },
  { value: 'annual',    label: 'Annuel',       description: 'Toute une année' },
  { value: 'custom',    label: 'Personnalisé', description: 'Plage de dates libre' },
];

interface ObjectiveEditorProps {
  obj: Objective;
  index: number;
  onChange: <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => void;
  onRemove: (id: string) => void;
  hiddenRemove?: boolean;
}

function ObjectiveEditor({ obj, index, onChange, onRemove, hiddenRemove }: ObjectiveEditorProps) {
  const bonus = obj.bonus ?? { enabled: false, type: 'percentage' as const, value: 10 };
  const bonusMode: ObjectiveBonusMode = obj.bonusMode ?? (bonus.enabled ? 'simple' : 'none');
  const tiers: ObjectiveBonusTier[] = obj.bonusTiers ?? [];
  const recurrence: ObjectiveRecurrence = obj.recurrence ?? 'none';
  const recurrenceEnabled = recurrence !== 'none';

  const setBonus = (patch: Partial<ObjectiveBonus>) => {
    onChange(obj.id, 'bonus', { ...bonus, ...patch });
  };

  const setBonusMode = (mode: ObjectiveBonusMode) => {
    onChange(obj.id, 'bonusMode', mode);
    if (mode === 'simple') onChange(obj.id, 'bonus', { ...bonus, enabled: true });
    if (mode === 'none') onChange(obj.id, 'bonus', { ...bonus, enabled: false });
  };

  const addTier = () => {
    const lastThreshold = tiers.length > 0 ? tiers[tiers.length - 1].threshold : 0;
    const newTier: ObjectiveBonusTier = {
      threshold: Math.min(lastThreshold + 20, 200),
      reward: { type: 'fixed', value: 100 },
    };
    onChange(obj.id, 'bonusTiers', [...tiers, newTier]);
  };

  const updateTier = (i: number, patch: Partial<ObjectiveBonusTier>) => {
    const updated = tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t);
    onChange(obj.id, 'bonusTiers', updated);
  };

  const removeTier = (i: number) => {
    onChange(obj.id, 'bonusTiers', tiers.filter((_, idx) => idx !== i));
  };

  const previewTiers = [...tiers].sort((a, b) => a.threshold - b.threshold)
    .map((t) => `À ${t.threshold}% → +${t.reward.type === 'fixed' ? `${t.reward.value}€` : `${t.reward.value}% CA`}`)
    .join(' | ');

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Objectif {index + 1}</span>
        {!hiddenRemove && (
          <button type="button" onClick={() => onRemove(obj.id)} className="text-gray-300 hover:text-red-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Intitulé</label>
        <input type="text" placeholder="ex : CA T1, Deals signés janvier…" value={obj.label} onChange={(e) => onChange(obj.id, 'label', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cible</label>
          <input type="number" min="0" placeholder="50 000" value={obj.target} onChange={(e) => onChange(obj.id, 'target', parseFloat(e.target.value) || 0)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Unité</label>
          <select value={obj.unit} onChange={(e) => onChange(obj.id, 'unit', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Période</label>
        <div className="grid grid-cols-2 gap-2">
          {PERIOD_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${obj.periodType === opt.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <input type="radio" className="sr-only" checked={obj.periodType === opt.value} onChange={() => onChange(obj.id, 'periodType', opt.value)} />
              <div><p className="text-xs font-semibold text-gray-800">{opt.label}</p><p className="text-xs text-gray-400">{opt.description}</p></div>
            </label>
          ))}
        </div>
      </div>

      <PeriodFields obj={obj} onChange={onChange} />

      {/* ── Prime de dépassement ── */}
      <div className="border-t border-gray-200 pt-4 space-y-3">
        <p className="text-xs font-semibold text-gray-700">Prime de dépassement</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'none',   label: 'Pas de prime' },
            { value: 'simple', label: 'Prime simple' },
            { value: 'tiered', label: 'Paliers personnalisés' },
          ] as { value: ObjectiveBonusMode; label: string }[]).map((opt) => (
            <label key={opt.value} className={`flex flex-col gap-0.5 p-2 rounded-lg border-2 cursor-pointer text-center transition-colors ${bonusMode === opt.value ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <input type="radio" className="sr-only" checked={bonusMode === opt.value} onChange={() => setBonusMode(opt.value)} />
              <span className="text-xs font-semibold text-gray-800">{opt.label}</span>
            </label>
          ))}
        </div>

        {bonusMode === 'simple' && (
          <div className="space-y-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer ${bonus.type === 'percentage' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" className="sr-only" checked={bonus.type === 'percentage'} onChange={() => setBonus({ type: 'percentage' })} />
                <div><p className="text-xs font-semibold text-gray-800">% des ventes</p><p className="text-xs text-gray-400">Au-dessus de la cible</p></div>
              </label>
              <label className={`flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer ${bonus.type === 'fixed' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" className="sr-only" checked={bonus.type === 'fixed'} onChange={() => setBonus({ type: 'fixed' })} />
                <div><p className="text-xs font-semibold text-gray-800">Montant fixe</p><p className="text-xs text-gray-400">Dès l'objectif atteint</p></div>
              </label>
            </div>
            <div className="relative">
              <input type="number" min="0" step={bonus.type === 'percentage' ? '0.5' : '50'} value={bonus.value} onChange={(e) => setBonus({ value: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">{bonus.type === 'percentage' ? '%' : '€'}</span>
            </div>
          </div>
        )}

        {bonusMode === 'tiered' && (
          <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
            {tiers.length > 0 && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-gray-500 px-1">
                  <span>Seuil (%)</span><span>Type</span><span>Montant</span><span />
                </div>
                {tiers.map((tier, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="number" min="1" max="200" value={tier.threshold}
                      onChange={(e) => updateTier(i, { threshold: parseInt(e.target.value) || 1 })}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <select
                      value={tier.reward.type}
                      onChange={(e) => updateTier(i, { reward: { ...tier.reward, type: e.target.value as 'fixed' | 'percentage' } })}
                      className="border border-gray-300 rounded-lg px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      <option value="fixed">Fixe (€)</option>
                      <option value="percentage">% CA</option>
                    </select>
                    <input
                      type="number" min="0" value={tier.reward.value}
                      onChange={(e) => updateTier(i, { reward: { ...tier.reward, value: parseFloat(e.target.value) || 0 } })}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <button type="button" onClick={() => removeTier(i)} className="text-gray-300 hover:text-red-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={addTier} className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Ajouter un palier
            </button>
            {previewTiers && (
              <p className="text-xs text-gray-500 italic mt-1">Aperçu : {previewTiers}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Récurrence ── */}
      <div className="border-t border-gray-200 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">Objectif récurrent</p>
            <p className="text-xs text-gray-400">Se régénère automatiquement chaque période</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(obj.id, 'recurrence', recurrenceEnabled ? 'none' : 'monthly')}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${recurrenceEnabled ? 'bg-primary-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${recurrenceEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {recurrenceEnabled && (
          <div className="space-y-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Fréquence</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'monthly',   label: 'Mensuel' },
                  { value: 'quarterly', label: 'Trimestriel' },
                  { value: 'annual',    label: 'Annuel' },
                ] as { value: ObjectiveRecurrence; label: string }[]).map((opt) => (
                  <label key={opt.value} className={`flex items-center justify-center p-2 rounded-lg border-2 cursor-pointer text-xs font-medium transition-colors ${recurrence === opt.value ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                    <input type="radio" className="sr-only" checked={recurrence === opt.value} onChange={() => onChange(obj.id, 'recurrence', opt.value)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Jusqu'au</label>
              <input
                type="date"
                value={obj.recurrenceEndDate ?? ''}
                onChange={(e) => onChange(obj.id, 'recurrenceEndDate', e.target.value || undefined)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {obj.recurrenceEndDate && (
              <p className="text-xs text-blue-600">
                Cet objectif sera généré chaque {recurrence === 'monthly' ? 'mois' : recurrence === 'quarterly' ? 'trimestre' : 'an'} jusqu'au {format(new Date(obj.recurrenceEndDate), 'dd/MM/yyyy')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Champs de période dynamiques
// ============================================================
interface PeriodFieldsProps {
  obj: Objective;
  onChange: <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => void;
}

function PeriodFields({ obj, onChange }: PeriodFieldsProps) {
  if (obj.periodType === 'monthly') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mois</label>
          <select value={obj.month ?? 1} onChange={(e) => onChange(obj.id, 'month', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }

  if (obj.periodType === 'quarterly') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Trimestre</label>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((q) => (
              <button key={q} type="button" onClick={() => onChange(obj.id, 'quarter', q)} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${obj.quarter === q ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>T{q}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }

  if (obj.periodType === 'annual') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
        <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    );
  }

  if (obj.periodType === 'custom') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
          <input type="date" value={obj.startDate ?? ''} onChange={(e) => onChange(obj.id, 'startDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
          <input type="date" value={obj.endDate ?? ''} min={obj.startDate ?? undefined} onChange={(e) => onChange(obj.id, 'endDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
      </div>
    );
  }

  return null;
}
