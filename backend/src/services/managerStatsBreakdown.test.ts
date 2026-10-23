/**
 * Tests des détails dépliables des cartes du tableau de bord manager.
 * Cas de référence : la démo immobilier (Lyon dirigée par Julien, Aix par le
 * manager général Nicolas).
 */
import { describe, it, expect } from 'vitest';
import { buildPendingByTeam, buildPaidBySeller } from './managerStatsBreakdown';

const teams = [
  { id: 'lyon', name: 'Lyon', color: '#f00', leadId: 'julien', leadName: 'Julien Faure' },
  { id: 'aix', name: 'Aix-en-Provence', color: '#0f0', leadId: 'nicolas', leadName: 'Nicolas Mercier' },
];

const sellers = new Map([
  ['sophie', { groupId: 'lyon', isTeamLead: false }],
  ['thomas', { groupId: 'lyon', isTeamLead: false }],
  ['marie', { groupId: 'aix', isTeamLead: false }],
  ['julien', { groupId: null, isTeamLead: true }],
  ['solo', { groupId: null, isTeamLead: false }],
]);

describe('buildPendingByTeam', () => {
  it('manager général : les ventes de Lyon sont chez Julien, Aix est à jour', () => {
    const rows = buildPendingByTeam({
      due: [
        { id: 'c1', userId: 'sophie', amount: 10400 },
        { id: 'c2', userId: 'thomas', amount: 9600 },
      ],
      mineIds: new Set(),
      sellers,
      teams,
      callerId: 'nicolas',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      groupId: 'lyon', amount: 20000, count: 2, myAmount: 0, myCount: 0,
      delegatedTo: 'Julien Faure', leadIsCaller: false,
    });
    expect(rows[1]).toMatchObject({ groupId: 'aix', amount: 0, count: 0, leadIsCaller: true });
  });

  it('la vente d\'un responsable (hors équipe) est rattachée à l\'équipe qu\'il dirige', () => {
    const rows = buildPendingByTeam({
      due: [
        { id: 'c1', userId: 'sophie', amount: 1000 },
        { id: 'c2', userId: 'julien', amount: 500 },
      ],
      mineIds: new Set(['c2']),
      sellers,
      teams,
      callerId: 'nicolas',
    });

    const lyon = rows.find((r) => r.groupId === 'lyon')!;
    expect(lyon).toMatchObject({ amount: 1500, count: 2, myAmount: 500, myCount: 1, delegatedTo: 'Julien Faure' });
  });

  it('responsable d\'équipe : ses propres ventes sont validées par le manager général', () => {
    const rows = buildPendingByTeam({
      due: [
        { id: 'c1', userId: 'sophie', amount: 1000 },
        { id: 'c2', userId: 'julien', amount: 500 },
      ],
      mineIds: new Set(['c1']),
      sellers,
      teams: [teams[0]],
      callerId: 'julien',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ myAmount: 1000, myCount: 1, delegatedTo: null, leadIsCaller: true });
  });

  it('« Sans équipe » n\'apparaît que s\'il y a des ventes en attente, et passe en dernier à montant égal', () => {
    const empty = buildPendingByTeam({ due: [], mineIds: new Set(), sellers, teams, callerId: 'nicolas' });
    expect(empty.some((r) => r.groupId === null)).toBe(false);

    const rows = buildPendingByTeam({
      due: [
        { id: 'c1', userId: 'solo', amount: 300 },
        { id: 'c2', userId: 'marie', amount: 300 },
      ],
      mineIds: new Set(['c1', 'c2']),
      sellers,
      teams,
      callerId: 'nicolas',
    });
    expect(rows.map((r) => r.groupName)).toEqual(['Aix-en-Provence', 'Sans équipe', 'Lyon']);
    expect(rows[1]).toMatchObject({ amount: 300, myAmount: 300 });
  });

  it('arrondit les sommes au centime', () => {
    const rows = buildPendingByTeam({
      due: [
        { id: 'c1', userId: 'marie', amount: 0.1 },
        { id: 'c2', userId: 'marie', amount: 0.2 },
      ],
      mineIds: new Set(['c1', 'c2']),
      sellers,
      teams,
      callerId: 'nicolas',
    });
    expect(rows[0].amount).toBe(0.3);
    expect(rows[0].myAmount).toBe(0.3);
  });
});

describe('buildPaidBySeller', () => {
  const names = new Map([
    ['sophie', { name: 'Sophie Lemaire', groupId: 'lyon' }],
    ['marie', { name: 'Marie Fontaine', groupId: 'aix' }],
    ['julien', { name: 'Julien Faure', groupId: null }],
    ['solo', { name: 'Solo Martin', groupId: null }],
  ]);

  it('trie par montant décroissant et rattache chacun à son équipe', () => {
    const rows = buildPaidBySeller({
      paid: [
        { userId: 'sophie', amount: 7000, count: 1 },
        { userId: 'marie', amount: 9000.004, count: 2 },
        { userId: 'solo', amount: 500, count: 1 },
      ],
      sellers: names,
      teams,
    });

    expect(rows.map((r) => r.name)).toEqual(['Marie Fontaine', 'Sophie Lemaire', 'Solo Martin']);
    expect(rows[0]).toMatchObject({ groupId: 'aix', groupName: 'Aix-en-Provence', amount: 9000, count: 2 });
    expect(rows[2]).toMatchObject({ groupId: null, groupName: null });
  });

  it('un responsable hors équipe est rattaché à l\'équipe qu\'il dirige', () => {
    const rows = buildPaidBySeller({ paid: [{ userId: 'julien', amount: 100, count: 1 }], sellers: names, teams });
    expect(rows[0]).toMatchObject({ groupId: 'lyon', groupName: 'Lyon', color: '#f00' });
  });

  it('ignore les lignes sans commission et nomme un utilisateur introuvable', () => {
    const rows = buildPaidBySeller({
      paid: [
        { userId: 'sophie', amount: 0, count: 0 },
        { userId: 'fantome', amount: 50, count: 1 },
      ],
      sellers: names,
      teams,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Utilisateur supprimé', groupId: null });
  });
});
