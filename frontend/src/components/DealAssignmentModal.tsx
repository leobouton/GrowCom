import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { api } from '../services/api';
import { dealAssignmentApiService } from '../services/dealAssignment.service';
import type { PublicUser, DealAssignment } from '@shared/types';

interface AssignmentRow {
  userId: string;
  share: number; // en % (0–100) pour l'UI
  role: string;
}

interface Props {
  dealId: string;
  dealTitle: string;
  existingAssignments: DealAssignment[];
  onClose: () => void;
  onSaved: () => void;
}

export function DealAssignmentModal({
  dealId,
  dealTitle,
  existingAssignments,
  onClose,
  onSaved,
}: Props) {
  const [teamMembers, setTeamMembers] = useState<PublicUser[]>([]);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charger l'équipe
  useEffect(() => {
    void api.get<{ success: true; data: PublicUser[] }>('/auth/team').then((res) => {
      const commercials = res.data.data.filter(
        (u) => u.role === 'COMMERCIAL' || u.role === 'RECRUITER',
      );
      setTeamMembers(commercials);

      // Pré-remplir depuis les assignations existantes
      if (existingAssignments.length > 0) {
        setRows(
          existingAssignments.map((a) => ({
            userId: a.userId,
            share: Math.round(a.share * 100),
            role: a.role ?? '',
          })),
        );
      } else {
        setRows([{ userId: '', share: 100, role: '' }]);
      }
      setLoading(false);
    });
  }, [existingAssignments]);

  const total = rows.reduce((sum, r) => sum + r.share, 0);
  const isValid = total === 100 && rows.every((r) => r.userId !== '') && rows.length > 0;

  const addRow = () => {
    setRows((prev) => [...prev, { userId: '', share: 0, role: '' }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof AssignmentRow, value: string | number) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  };

  const handleSave = async () => {
    if (!isValid) return;
    setError(null);
    setSaving(true);
    try {
      await dealAssignmentApiService.updateAssignments(
        dealId,
        rows.map((r) => ({
          userId: r.userId,
          share: r.share / 100,
          role: r.role || null,
        })),
      );
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Commerciaux déjà sélectionnés dans d'autres lignes
  const usedIds = rows.map((r) => r.userId);

  return (
    <Modal isOpen onClose={onClose} title={`Commerciaux affectés — ${dealTitle}`}>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            La somme des parts doit être égale à 100 %.
          </p>

          {/* Lignes d'assignation */}
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                {/* Commercial */}
                <select
                  value={row.userId}
                  onChange={(e) => updateRow(index, 'userId', e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">— Choisir un commercial —</option>
                  {teamMembers.map((u) => (
                    <option
                      key={u.id}
                      value={u.id}
                      disabled={usedIds.includes(u.id) && row.userId !== u.id}
                    >
                      {u.firstName} {u.lastName}
                    </option>
                  ))}
                </select>

                {/* Part en % */}
                <div className="flex items-center gap-1 w-24">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={row.share}
                    onChange={(e) => updateRow(index, 'share', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 text-center focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>

                {/* Rôle */}
                <input
                  type="text"
                  placeholder="Rôle (ex: Hunter)"
                  value={row.role}
                  onChange={(e) => updateRow(index, 'role', e.target.value)}
                  className="w-32 text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />

                {/* Supprimer */}
                {rows.length > 1 && (
                  <button
                    onClick={() => removeRow(index)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    title="Supprimer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Total */}
          <div className={`text-sm font-medium ${total === 100 ? 'text-green-600' : 'text-red-600'}`}>
            Total : {total}%
            {total !== 100 && ` — il manque ${100 - total}% pour atteindre 100%`}
          </div>

          {/* Ajouter une ligne */}
          <button
            onClick={addRow}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ajouter un commercial
          </button>

          {/* Erreur */}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={!isValid}>
              Enregistrer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
