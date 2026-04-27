import { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { api } from '../../services/api';
import type { PublicUser } from '@shared/types';
import { UserRole } from '@shared/types';

interface Group {
  id: string;
  name: string;
  color: string;
  leadId: string | null;
  lead: (PublicUser & { groupId: string | null }) | null;
  members: (PublicUser & { groupId: string | null })[];
}

interface OrgChartProps {
  groups: Group[];
  unassigned: (PublicUser & { groupId: string | null })[];
  onRefresh: () => void;
  onMemberClick?: (member: PublicUser) => void;
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
];

// ─── Libellé de rôle ────────────────────────────────────────
function roleLabel(role: UserRole): string | null {
  if (role === UserRole.MANAGER)   return 'Manager';
  if (role === UserRole.TEAM_LEAD || role === UserRole.BU_MANAGER) return 'Resp. de secteur';
  if (role === UserRole.RECRUITER) return 'Recruteur';
  return null;
}

// ─── Carte membre (draggable) ────────────────────────────────
function MemberCard({ member, isDragging = false, onMemberClick }: {
  member: PublicUser & { groupId?: string | null };
  isDragging?: boolean;
  onMemberClick?: (member: PublicUser) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: member.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const label = roleLabel(member.role);
  const isManager = member.role === UserRole.MANAGER;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onMemberClick?.(member)}
      title="Cliquer pour voir la fiche"
      className={`flex items-center gap-2 px-3 py-2 bg-white rounded-lg border shadow-sm cursor-grab active:cursor-grabbing select-none transition-opacity ${isDragging ? 'opacity-0' : 'hover:border-primary-300 hover:shadow'} ${isManager ? 'border-indigo-200 bg-indigo-50' : 'border-gray-100'}`}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isManager ? 'bg-indigo-100' : 'bg-blue-100'}`}>
        <span className={`font-semibold text-xs ${isManager ? 'text-indigo-700' : 'text-blue-700'}`}>{member.firstName[0]}{member.lastName[0]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{member.firstName} {member.lastName}</p>
        {label && <p className={`text-xs ${isManager ? 'text-indigo-500' : 'text-gray-400'}`}>{label}</p>}
        {!member.emailVerified && <p className="text-xs text-yellow-500">Invitation en attente</p>}
      </div>
      <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    </div>
  );
}

// ─── Carte lead dans la colonne non-assigné (draggable) ─────
function TeamLeadBadgeCard({ member, isDragging = false, onMemberClick }: {
  member: PublicUser;
  isDragging?: boolean;
  onMemberClick?: (member: PublicUser) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: member.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const label = roleLabel(member.role) ?? 'Responsable';
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onMemberClick?.(member)}
      title="Cliquer pour voir la fiche"
      className={`flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg border border-purple-200 cursor-grab active:cursor-grabbing select-none transition-opacity ${isDragging ? 'opacity-0' : 'hover:border-purple-400 hover:shadow-sm'}`}
    >
      <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
        <span className="text-purple-700 font-semibold text-xs">{member.firstName[0]}{member.lastName[0]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{member.firstName} {member.lastName}</p>
        <p className="text-xs text-purple-500">{label}</p>
        {!member.emailVerified && <p className="text-xs text-yellow-500">Invitation en attente</p>}
      </div>
      <svg className="w-3 h-3 text-purple-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    </div>
  );
}

// ─── Carte responsable assigné à un groupe ──────────────────
function LeadCard({ lead, onRemove, onMemberClick }: {
  lead: PublicUser;
  onRemove: () => void;
  onMemberClick?: (member: PublicUser) => void;
}) {
  const label = roleLabel(lead.role) ?? 'Resp. de secteur';
  return (
    <div
      onClick={() => onMemberClick?.(lead)}
      title="Cliquer pour voir la fiche"
      className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg border border-purple-200 select-none cursor-pointer hover:border-purple-400 transition-colors"
    >
      <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
        <span className="text-purple-700 font-semibold text-xs">{lead.firstName[0]}{lead.lastName[0]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{lead.firstName} {lead.lastName}</p>
        <p className="text-xs text-purple-500">{label}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
        title="Retirer le responsable"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Aperçu fantôme pendant le drag ─────────────────────────
function DragPreview({ member }: { member: PublicUser }) {
  const isLead = member.role === UserRole.TEAM_LEAD || member.role === UserRole.BU_MANAGER || member.role === UserRole.MANAGER;
  const label = roleLabel(member.role);
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-primary-400 shadow-xl cursor-grabbing select-none opacity-95 ${isLead ? 'bg-purple-50' : 'bg-white'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isLead ? 'bg-purple-100' : 'bg-blue-100'}`}>
        <span className={`font-semibold text-xs ${isLead ? 'text-purple-700' : 'text-blue-700'}`}>{member.firstName[0]}{member.lastName[0]}</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{member.firstName} {member.lastName}</p>
        {label && <p className={`text-xs ${isLead ? 'text-purple-500' : 'text-gray-400'}`}>{label}</p>}
      </div>
    </div>
  );
}

// ─── Colonne d'un groupe (droppable) ────────────────────────
function GroupColumn({
  group,
  isOver,
  activeMemberId,
  availableLeads,
  onRename,
  onDelete,
  onAssignLead,
  onRemoveLead,
  onMemberClick,
}: {
  group: Group;
  isOver: boolean;
  activeMemberId: string | null;
  availableLeads: (PublicUser & { groupId: string | null })[];
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAssignLead: (groupId: string, leadId: string) => void;
  onRemoveLead: (groupId: string) => void;
  onMemberClick?: (member: PublicUser) => void;
}) {
  const { setNodeRef } = useDroppable({ id: group.id });
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(group.name);
  const [showLeadSelect, setShowLeadSelect] = useState(false);

  const handleRename = () => {
    if (nameValue.trim() && nameValue !== group.name) onRename(group.id, nameValue.trim());
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border-2 transition-colors min-w-[220px] w-60 flex-shrink-0 ${
        isOver ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      {/* En-tête */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
          {editing ? (
            <input
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              className="text-sm font-semibold text-gray-800 bg-transparent border-b border-primary-400 outline-none w-full"
            />
          ) : (
            <span
              className="text-sm font-semibold text-gray-800 truncate cursor-pointer hover:text-primary-600"
              onDoubleClick={() => setEditing(true)}
              title="Double-cliquer pour renommer"
            >
              {group.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs text-gray-400 font-medium">{group.members.length}</span>
          <button
            onClick={() => onDelete(group.id)}
            className="ml-1 text-gray-300 hover:text-red-400 transition-colors"
            title="Supprimer ce groupe"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Slot Responsable */}
      <div className="px-2 pt-2 pb-1.5 border-b border-gray-200">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Responsable</p>
        {group.lead ? (
          <LeadCard lead={group.lead} onRemove={() => onRemoveLead(group.id)} onMemberClick={onMemberClick} />
        ) : (
          <div className="relative">
            <button
              onClick={() => setShowLeadSelect(!showLeadSelect)}
              disabled={availableLeads.length === 0}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 border border-dashed border-gray-300 rounded-lg hover:border-purple-300 hover:text-purple-500 hover:bg-purple-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {availableLeads.length === 0 ? 'Aucun resp. de secteur disponible' : 'Désigner un responsable'}
            </button>
            {showLeadSelect && availableLeads.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {availableLeads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => {
                      onAssignLead(group.id, lead.id);
                      setShowLeadSelect(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-purple-50 text-left transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-purple-700 font-semibold text-xs">{lead.firstName[0]}{lead.lastName[0]}</span>
                    </div>
                    <span className="text-sm text-gray-700">{lead.firstName} {lead.lastName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Membres commerciaux */}
      <div className="flex flex-col gap-1.5 p-2 min-h-[60px]">
        {group.members.map((m) => (
          <MemberCard key={m.id} member={m} isDragging={activeMemberId === m.id} onMemberClick={onMemberClick} />
        ))}
        {group.members.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3 italic">Déposez ici</p>
        )}
      </div>
    </div>
  );
}

// ─── Zone "Sans équipe" (droppable) ─────────────────────────
function UnassignedColumn({
  members,
  isOver,
  activeMemberId,
  onMemberClick,
}: {
  members: (PublicUser & { groupId: string | null })[];
  isOver: boolean;
  activeMemberId: string | null;
  onMemberClick?: (member: PublicUser) => void;
}) {
  const { setNodeRef } = useDroppable({ id: 'unassigned' });
  const leads = members.filter((m) => m.role === UserRole.TEAM_LEAD || m.role === UserRole.BU_MANAGER || m.role === UserRole.MANAGER);
  const commercials = members.filter((m) => m.role !== UserRole.TEAM_LEAD && m.role !== UserRole.BU_MANAGER && m.role !== UserRole.MANAGER);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border-2 border-dashed transition-colors min-w-[220px] w-60 flex-shrink-0 ${
        isOver ? 'border-gray-400 bg-gray-100' : 'border-gray-300 bg-gray-50/50'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200">
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-500">Sans équipe</span>
        <span className="text-xs text-gray-400 font-medium ml-auto">{members.length}</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2 min-h-[60px]">
        {leads.map((m) => (
          <TeamLeadBadgeCard key={m.id} member={m} isDragging={activeMemberId === m.id} onMemberClick={onMemberClick} />
        ))}
        {commercials.map((m) => (
          <MemberCard key={m.id} member={m} isDragging={activeMemberId === m.id} onMemberClick={onMemberClick} />
        ))}
        {members.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3 italic">Aucun</p>
        )}
      </div>
    </div>
  );
}

// ─── Composant principal ─────────────────────────────────────
export function OrgChart({ groups, unassigned, onRefresh, onMemberClick }: OrgChartProps) {
  const [localGroups, setLocalGroups] = useState<Group[]>(groups);
  const [localUnassigned, setLocalUnassigned] = useState(unassigned);
  const [activeMember, setActiveMember] = useState<(PublicUser & { groupId: string | null }) | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(COLORS[0]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useState(() => {
    setLocalGroups(groups);
    setLocalUnassigned(unassigned);
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const availableLeads = localUnassigned.filter((u) => u.role === UserRole.TEAM_LEAD || u.role === UserRole.BU_MANAGER || u.role === UserRole.MANAGER);

  const findMember = (memberId: string) => {
    for (const g of localGroups) {
      const found = g.members.find((m) => m.id === memberId);
      if (found) return { member: found, sourceGroupId: g.id };
    }
    const found = localUnassigned.find((m) => m.id === memberId);
    if (found) return { member: found, sourceGroupId: null };
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const result = findMember(String(event.active.id));
    if (result) setActiveMember(result.member);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverColumnId(event.over ? String(event.over.id) : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveMember(null);
    setOverColumnId(null);
    if (!over) return;

    const memberId = String(active.id);
    const targetColumnId = String(over.id);
    const result = findMember(memberId);
    if (!result) return;

    const { member, sourceGroupId } = result;
    const targetGroupId = targetColumnId === 'unassigned' ? null : targetColumnId;
    if (sourceGroupId === targetGroupId) return;

    // Mise à jour optimiste
    setLocalGroups((prev) =>
      prev.map((g) => {
        if (g.id === sourceGroupId) return { ...g, members: g.members.filter((m) => m.id !== memberId) };
        if (g.id === targetGroupId) return { ...g, members: [...g.members, { ...member, groupId: targetGroupId }] };
        return g;
      }),
    );
    if (sourceGroupId === null) setLocalUnassigned((prev) => prev.filter((m) => m.id !== memberId));
    if (targetGroupId === null) setLocalUnassigned((prev) => [...prev, { ...member, groupId: null }]);

    try {
      const endpoint = targetGroupId
        ? `/groups/${targetGroupId}/members/${memberId}`
        : `/groups/${sourceGroupId}/members/${memberId}`;
      await api.patch(endpoint, { groupId: targetGroupId });
    } catch {
      onRefresh();
    }
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreateError(null);
    setSaving(true);
    try {
      const res = await api.post<{ success: true; data: Group }>('/groups', {
        name: newGroupName.trim(),
        color: newGroupColor,
      });
      setLocalGroups((prev) => [...prev, { ...res.data.data, lead: null, members: [] }]);
      setNewGroupName('');
      setShowAdd(false);
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { error?: { message?: string } } } })?.response?.status;
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      if (!status) {
        setCreateError('Serveur inaccessible — vérifiez que le backend est démarré.');
      } else {
        setCreateError(`Erreur ${status} : ${msg ?? 'Erreur inconnue'}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (groupId: string, name: string) => {
    try {
      await api.patch(`/groups/${groupId}`, { name });
      setLocalGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, name } : g));
    } catch { onRefresh(); }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await api.delete(`/groups/${groupId}`);
      const deleted = localGroups.find((g) => g.id === groupId);
      setLocalGroups((prev) => prev.filter((g) => g.id !== groupId));
      if (deleted) {
        const freed = [
          ...deleted.members.map((m) => ({ ...m, groupId: null as string | null })),
          ...(deleted.lead ? [{ ...deleted.lead, groupId: null as string | null }] : []),
        ];
        setLocalUnassigned((prev) => [...prev, ...freed]);
      }
    } catch { onRefresh(); }
  };

  const handleAssignLead = async (groupId: string, leadId: string) => {
    try {
      await api.patch(`/groups/${groupId}/lead`, { leadId });
      const leadUser = localUnassigned.find((u) => u.id === leadId) ?? null;
      setLocalGroups((prev) =>
        prev.map((g) => g.id === groupId ? { ...g, leadId, lead: leadUser } : g),
      );
      setLocalUnassigned((prev) => prev.filter((u) => u.id !== leadId));
    } catch { onRefresh(); }
  };

  const handleRemoveLead = async (groupId: string) => {
    const group = localGroups.find((g) => g.id === groupId);
    if (!group?.lead) return;
    try {
      await api.patch(`/groups/${groupId}/lead`, { leadId: null });
      const freed = { ...group.lead, groupId: null as string | null };
      setLocalGroups((prev) =>
        prev.map((g) => g.id === groupId ? { ...g, leadId: null, lead: null } : g),
      );
      setLocalUnassigned((prev) => [...prev, freed]);
    } catch { onRefresh(); }
  };

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Organigramme des équipes</h2>
          <p className="text-sm text-gray-500">Glissez-déposez les membres · Désignez les responsables de secteur</p>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setCreateError(null); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nouvelle équipe
        </button>
      </div>

      {/* Formulaire nouvelle équipe */}
      {showAdd && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewGroupColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-transform ${newGroupColor === c ? 'border-gray-700 scale-125' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleAddGroup()}
              placeholder="Nom de l'équipe (ex: Région Sud)"
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <button
              onClick={() => void handleAddGroup()}
              disabled={saving || !newGroupName.trim()}
              className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Création…' : 'Créer'}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {createError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <p className="text-sm text-red-600">{createError}</p>
            </div>
          )}
        </div>
      )}

      {/* Organigramme */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={(e) => void handleDragEnd(e)}
      >
        <div className="flex gap-4 overflow-x-auto pb-3">
          <UnassignedColumn
            members={localUnassigned}
            isOver={overColumnId === 'unassigned'}
            activeMemberId={activeMember?.id ?? null}
            onMemberClick={onMemberClick}
          />

          {localGroups.length > 0 && (
            <div className="w-px bg-gray-200 self-stretch flex-shrink-0" />
          )}

          {localGroups.map((group) => (
            <GroupColumn
              key={group.id}
              group={group}
              isOver={overColumnId === group.id}
              activeMemberId={activeMember?.id ?? null}
              availableLeads={availableLeads}
              onRename={handleRename}
              onDelete={handleDeleteGroup}
              onAssignLead={handleAssignLead}
              onRemoveLead={handleRemoveLead}
              onMemberClick={onMemberClick}
            />
          ))}

          {localGroups.length === 0 && (
            <div className="flex items-center justify-center flex-1 py-8 text-gray-400 text-sm italic">
              Créez votre première équipe ci-dessus
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeMember && <DragPreview member={activeMember} />}
        </DragOverlay>
      </DndContext>

      <p className="text-xs text-gray-400">
        Cliquez sur une carte pour ouvrir la fiche · Double-cliquez sur le nom d'une équipe pour la renommer · Glissez les commerciaux entre les équipes
      </p>
    </div>
  );
}
