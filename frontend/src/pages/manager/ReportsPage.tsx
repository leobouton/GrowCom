import { useState, useEffect, useCallback, useRef } from 'react';
import { payrollReportService } from '../../services/payrollReport.service';
import { api } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { PayrollReportPreview, PublicUser } from '@shared/types';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const ROLE_LABELS: Record<string, string> = {
  COMMERCIAL: 'Commercial',
  RECRUITER: 'Recruteur',
  TEAM_LEAD: 'Resp. secteur',
  BU_MANAGER: 'Dir. régional',
  MANAGER: 'Manager',
};

interface Group {
  id: string;
  name: string;
  color: string;
  lead?: { id: string; firstName: string; lastName: string } | null;
  members: PublicUser[];
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function ReportsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<PublicUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [preview, setPreview] = useState<PayrollReportPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  useEffect(() => {
    const load = async () => {
      try {
        const [teamRes, groupsRes] = await Promise.all([
          api.get<{ success: true; data: PublicUser[] }>('/auth/team'),
          api.get<{ success: true; data: Group[] }>('/groups').catch(() => ({ data: { data: [] as Group[] } })),
        ]);
        setTeamMembers(teamRes.data.data);
        setGroups(groupsRes.data.data);
      } catch {
        setTeamMembers([]);
        setGroups([]);
      } finally {
        setTeamLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const ids = selectedUserIds.size > 0 ? Array.from(selectedUserIds) : undefined;
      const data = await payrollReportService.preview(year, month, ids);
      setPreview(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Impossible de charger la prévisualisation.');
    } finally {
      setPreviewLoading(false);
    }
  }, [year, month, selectedUserIds]);

  const handleDownload = async () => {
    setPdfLoading(true);
    setError(null);
    try {
      const ids = selectedUserIds.size > 0 ? Array.from(selectedUserIds) : undefined;
      await payrollReportService.downloadPdf(year, month, ids);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message ?? 'Impossible de télécharger le PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    if (!teamLoading) {
      void handlePreview();
    }
  }, [year, month, selectedUserIds, teamLoading, handlePreview]);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectGroup = (group: Group) => {
    const memberIds = group.members.map((m) => m.id);
    if (group.lead) memberIds.push(group.lead.id);
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      const allSelected = memberIds.every((id) => next.has(id));
      if (allSelected) {
        memberIds.forEach((id) => next.delete(id));
      } else {
        memberIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const isGroupFullySelected = (group: Group) => {
    const memberIds = group.members.map((m) => m.id);
    if (group.lead) memberIds.push(group.lead.id);
    return memberIds.length > 0 && memberIds.every((id) => selectedUserIds.has(id));
  };

  const isGroupPartiallySelected = (group: Group) => {
    const memberIds = group.members.map((m) => m.id);
    if (group.lead) memberIds.push(group.lead.id);
    return memberIds.some((id) => selectedUserIds.has(id)) && !isGroupFullySelected(group);
  };

  const selectAll = () => {
    setSelectedUserIds(new Set(teamMembers.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelectedUserIds(new Set());
  };

  const filteredMembers = teamMembers.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      (ROLE_LABELS[m.role] ?? m.role).toLowerCase().includes(q)
    );
  });

  const groupedMemberIds = new Set(groups.flatMap((g) => [...g.members.map((m) => m.id), ...(g.lead ? [g.lead.id] : [])]));
  const ungroupedMembers = filteredMembers.filter((m) => !groupedMemberIds.has(m.id));

  const selectionLabel = selectedUserIds.size === 0
    ? 'Tous les collaborateurs'
    : selectedUserIds.size === 1
      ? (() => { const u = teamMembers.find((m) => m.id === Array.from(selectedUserIds)[0]); return u ? `${u.firstName} ${u.lastName}` : '1 sélectionné'; })()
      : `${selectedUserIds.size} collaborateurs sélectionnés`;

  const totalFixed = preview?.items.reduce((s, i) => s + i.fixedSalaryTotal, 0) ?? 0;
  const totalCommissions = preview?.items.reduce((s, i) => s + i.commissionsTotal, 0) ?? 0;
  const totalBonus = preview?.items.reduce((s, i) => s + i.bonusTotal, 0) ?? 0;
  const totalAdj = preview?.items.reduce((s, i) => s + i.adjustmentsTotal, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rapports de paie</h1>
          <p className="text-sm text-gray-500 mt-1">
            Synthèse des rémunérations — {MONTHS[month - 1]} {year}
          </p>
        </div>
        <Button
          loading={pdfLoading}
          onClick={() => void handleDownload()}
          disabled={!preview || preview.items.length === 0}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Télécharger le PDF
        </Button>
      </div>

      {/* Filtres */}
      <Card>
        <div className="space-y-4">
          {/* Mois */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Période</label>
            <div className="flex items-center gap-3">
              <div className="grid grid-cols-12 rounded-lg border border-gray-200 overflow-hidden flex-1">
                {MONTHS.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => setMonth(i + 1)}
                    className={`py-2.5 text-xs font-medium transition-all ${
                      month === i + 1
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    }`}
                    title={name}
                  >
                    {name.substring(0, 3)}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden flex-shrink-0">
                {yearOptions.map((y) => (
                  <button
                    key={y}
                    onClick={() => setYear(y)}
                    className={`px-4 py-2.5 text-xs font-medium transition-all ${
                      year === y
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Collaborateurs */}
          <div ref={dropdownRef}>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Collaborateurs</label>
            <div className="relative">
              <div
                className="flex items-center border border-gray-200 rounded-lg bg-white cursor-pointer hover:border-primary-300 transition-colors"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                <div className="flex items-center flex-1 min-w-0 px-3 py-2.5">
                  {selectedUserIds.size === 0 ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-sm">Tous les collaborateurs</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-600 text-white text-xs font-bold flex-shrink-0">
                        {selectedUserIds.size}
                      </span>
                      <span className="text-sm font-medium text-gray-700 truncate">{selectionLabel}</span>
                    </div>
                  )}
                </div>
                {selectedUserIds.size > 0 && (
                  <button
                    className="px-2 py-2 text-gray-400 hover:text-gray-600"
                    onClick={(e) => { e.stopPropagation(); clearSelection(); }}
                    title="Réinitialiser la sélection"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <div className="px-2 py-2 text-gray-400">
                  <svg className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {showDropdown && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-96 overflow-hidden">
                  <div className="p-2 border-b border-gray-100">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Rechercher par nom, email ou rôle..."
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      autoFocus
                    />
                  </div>

                  <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
                    <button
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2 py-1 rounded-md transition-colors"
                      onClick={clearSelection}
                    >
                      Tous (pas de filtre)
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2 py-1 rounded-md transition-colors"
                      onClick={selectAll}
                    >
                      Tout cocher
                    </button>
                  </div>

                  <div className="overflow-y-auto max-h-72">
                    {teamLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
                      </div>
                    ) : (
                      <>
                        {groups.length > 0 && !searchQuery && (
                          <div>
                            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Par équipe</span>
                            </div>
                            {groups.map((group) => {
                              const count = group.members.length + (group.lead ? 1 : 0);
                              const fullySelected = isGroupFullySelected(group);
                              const partiallySelected = isGroupPartiallySelected(group);
                              return (
                                <button
                                  key={group.id}
                                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-3 border-b border-gray-50"
                                  onClick={() => selectGroup(group)}
                                >
                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                    fullySelected ? 'bg-primary-600 border-primary-600'
                                      : partiallySelected ? 'bg-primary-100 border-primary-600'
                                        : 'border-gray-300'
                                  }`}>
                                    {fullySelected && (
                                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                    {partiallySelected && <div className="w-2 h-0.5 bg-primary-600 rounded" />}
                                  </div>
                                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color || '#6b7280' }} />
                                  <div className="min-w-0 flex-1">
                                    <span className="font-medium text-gray-900">{group.name}</span>
                                    <span className="text-gray-400 ml-1.5 text-xs">{count} membre{count > 1 ? 's' : ''}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {groups.filter((g) => {
                          if (!searchQuery) return true;
                          const allMembers = [...g.members, ...(g.lead ? [g.lead as PublicUser] : [])];
                          return allMembers.some((m) => filteredMembers.some((fm) => fm.id === m.id));
                        }).map((group) => {
                          const groupFilteredMembers = filteredMembers.filter(
                            (m) => group.members.some((gm) => gm.id === m.id) || (group.lead && group.lead.id === m.id),
                          );
                          if (groupFilteredMembers.length === 0) return null;
                          return (
                            <div key={group.id}>
                              <div className="px-3 py-1.5 bg-gray-50 border-y border-gray-100 flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color || '#6b7280' }} />
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{group.name}</span>
                              </div>
                              {groupFilteredMembers.map((m) => (
                                <MemberCheckbox
                                  key={m.id}
                                  member={m}
                                  checked={selectedUserIds.has(m.id)}
                                  onToggle={() => toggleUser(m.id)}
                                  isLead={group.lead?.id === m.id}
                                />
                              ))}
                            </div>
                          );
                        })}

                        {ungroupedMembers.length > 0 && (
                          <div>
                            <div className="px-3 py-1.5 bg-gray-50 border-y border-gray-100">
                              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sans équipe</span>
                            </div>
                            {ungroupedMembers.map((m) => (
                              <MemberCheckbox
                                key={m.id}
                                member={m}
                                checked={selectedUserIds.has(m.id)}
                                onToggle={() => toggleUser(m.id)}
                              />
                            ))}
                          </div>
                        )}

                        {filteredMembers.length === 0 && (
                          <p className="text-center text-sm text-gray-400 py-4">Aucun résultat</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedUserIds.size > 0 && selectedUserIds.size <= 5 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Array.from(selectedUserIds).map((uid) => {
                  const u = teamMembers.find((m) => m.id === uid);
                  if (!u) return null;
                  return (
                    <span
                      key={uid}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-50 text-primary-700 text-xs font-medium border border-primary-100"
                    >
                      {u.firstName} {u.lastName}
                      <button className="hover:text-primary-900 transition-colors ml-0.5" onClick={() => toggleUser(uid)}>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2.5 border border-red-100">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}
      </Card>

      {/* Contenu */}
      {previewLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            <p className="text-sm text-gray-400">Chargement du rapport...</p>
          </div>
        </div>
      ) : preview && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-400 mb-1">Salaires fixes</p>
              <p className="text-lg font-bold text-gray-900">{formatEur(totalFixed)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-400 mb-1">Commissions</p>
              <p className="text-lg font-bold text-green-700">{formatEur(totalCommissions)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-400 mb-1">Primes objectifs</p>
              <p className="text-lg font-bold text-blue-700">{formatEur(totalBonus)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-400 mb-1">Ajustements</p>
              <p className={`text-lg font-bold ${totalAdj < 0 ? 'text-red-600' : totalAdj > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                {totalAdj !== 0 ? formatEur(totalAdj) : '—'}
              </p>
            </div>
            <div className="bg-primary-600 rounded-xl p-4 text-white col-span-2 lg:col-span-1">
              <p className="text-xs font-medium text-primary-200 mb-1">Total à verser</p>
              <p className="text-lg font-bold">{formatEur(preview.grandTotal)}</p>
              {preview.items.length > 1 && (
                <p className="text-xs text-primary-200 mt-0.5">{preview.items.length} collaborateurs</p>
              )}
            </div>
          </div>

          {/* Barre de répartition */}
          {preview.grandTotal > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Répartition de la masse salariale</p>
              <div className="flex rounded-full h-3 overflow-hidden bg-gray-100">
                {totalFixed > 0 && (
                  <div
                    className="bg-gray-400 transition-all duration-500"
                    style={{ width: `${(totalFixed / preview.grandTotal) * 100}%` }}
                    title={`Fixes : ${formatEur(totalFixed)}`}
                  />
                )}
                {totalCommissions > 0 && (
                  <div
                    className="bg-green-500 transition-all duration-500"
                    style={{ width: `${(totalCommissions / preview.grandTotal) * 100}%` }}
                    title={`Commissions : ${formatEur(totalCommissions)}`}
                  />
                )}
                {(totalBonus + totalAdj) > 0 && (
                  <div
                    className="bg-blue-500 transition-all duration-500"
                    style={{ width: `${(Math.max(0, totalBonus + totalAdj) / preview.grandTotal) * 100}%` }}
                    title={`Primes + ajustements : ${formatEur(totalBonus + totalAdj)}`}
                  />
                )}
              </div>
              <div className="flex items-center gap-5 mt-2.5 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                  Fixes ({preview.grandTotal > 0 ? Math.round((totalFixed / preview.grandTotal) * 100) : 0}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  Commissions ({preview.grandTotal > 0 ? Math.round((totalCommissions / preview.grandTotal) * 100) : 0}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  Primes & ajust. ({preview.grandTotal > 0 ? Math.round(((totalBonus + totalAdj) / preview.grandTotal) * 100) : 0}%)
                </span>
              </div>
            </div>
          )}

          {/* Tableau détail */}
          {preview.items.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="font-medium text-gray-500">Aucune donnée pour cette période</p>
                <p className="text-sm text-gray-400 mt-1">Essayez de sélectionner un autre mois ou une autre année</p>
              </div>
            </Card>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/80">
                      <th className="text-left py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wider">Collaborateur</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wider">Fixe</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wider">Commissions</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wider">Primes</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wider">Ajustements</th>
                      <th className="text-right py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.items.map((item) => (
                      <tr key={item.userId} className="hover:bg-gray-50/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                              {item.user.firstName[0]}{item.user.lastName[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{item.user.firstName} {item.user.lastName}</p>
                              <p className="text-xs text-gray-400 truncate">{item.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right text-gray-700 tabular-nums font-medium">
                          {formatEur(item.fixedSalaryTotal)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums">
                          <span className={item.commissionsTotal > 0 ? 'text-green-700 font-medium' : 'text-gray-300'}>
                            {item.commissionsTotal > 0 ? formatEur(item.commissionsTotal) : '—'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums">
                          <span className={item.bonusTotal > 0 ? 'text-blue-700 font-medium' : 'text-gray-300'}>
                            {item.bonusTotal > 0 ? formatEur(item.bonusTotal) : '—'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums">
                          {item.adjustmentsTotal !== 0 ? (
                            <span className={item.adjustmentsTotal < 0 ? 'text-red-600 font-medium' : 'text-blue-700 font-medium'}>
                              {item.adjustmentsTotal > 0 ? '+' : ''}{formatEur(item.adjustmentsTotal)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-bold text-gray-900 tabular-nums">{formatEur(item.netTotal)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {preview.items.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold">
                        <td className="py-3.5 px-4 text-gray-700 text-xs uppercase tracking-wider">
                          Total ({preview.items.length})
                        </td>
                        <td className="py-3.5 px-4 text-right text-gray-700 tabular-nums">{formatEur(totalFixed)}</td>
                        <td className="py-3.5 px-4 text-right text-green-700 tabular-nums">{formatEur(totalCommissions)}</td>
                        <td className="py-3.5 px-4 text-right text-blue-700 tabular-nums">{formatEur(totalBonus)}</td>
                        <td className="py-3.5 px-4 text-right tabular-nums">{formatEur(totalAdj)}</td>
                        <td className="py-3.5 px-4 text-right text-gray-900 tabular-nums">{formatEur(preview.grandTotal)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemberCheckbox({
  member,
  checked,
  onToggle,
  isLead,
}: {
  member: PublicUser;
  checked: boolean;
  onToggle: () => void;
  isLead?: boolean;
}) {
  return (
    <button
      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
      onClick={onToggle}
    >
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        checked ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
      }`}>
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
        checked ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'
      }`}>
        {member.firstName[0]}{member.lastName[0]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-900 truncate">{member.firstName} {member.lastName}</span>
          {isLead && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">LEAD</span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate">
          {ROLE_LABELS[member.role] ?? member.role} — {member.email}
        </p>
      </div>
    </button>
  );
}
