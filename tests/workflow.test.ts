import { describe, it, expect } from 'vitest';
import { requiredApprovals, approvalBlock, editPolicy } from '@/lib/workflow';

const base = { userId: 'u1', creatorId: 'u2', amountMad: 5000, threshold: 2000, doubleThreshold: null as number | null, approvedBy: [] as string[] };

describe('double validation', () => {
  it('1 autorisation par défaut, 2 au-delà du seuil de double validation', () => {
    expect(requiredApprovals(5000, null)).toBe(1);
    expect(requiredApprovals(5000, 0)).toBe(1);
    expect(requiredApprovals(3000, 3000)).toBe(1);
    expect(requiredApprovals(3000.01, 3000)).toBe(2);
  });
});

describe('séparation des pouvoirs', () => {
  it('le demandeur peut s’autoriser sous le seuil', () => {
    expect(approvalBlock({ ...base, userId: 'u2', amountMad: 2000 })).toBeNull();
  });
  it('le demandeur ne peut pas s’autoriser au-delà du seuil', () => {
    expect(approvalBlock({ ...base, userId: 'u2' })).toMatch(/personne distincte/);
  });
  it('un tiers peut autoriser', () => {
    expect(approvalBlock(base)).toBeNull();
  });
  it('double validation : même approbateur deux fois interdit', () => {
    expect(approvalBlock({ ...base, doubleThreshold: 3000, approvedBy: ['u1'] })).toMatch(/déjà autorisé/);
  });
  it('double validation : le demandeur ne compte jamais, même sous le seuil simple', () => {
    expect(approvalBlock({ ...base, userId: 'u2', amountMad: 1500, threshold: 2000, doubleThreshold: 1000 })).toMatch(/Double validation/);
  });
});

describe('droit de modification', () => {
  const c = { isCreator: true, canRequest: true, canEdit: false };
  it('brouillon : le demandeur modifie sans motif', () => {
    expect(editPolicy({ ...c, status: 'DRAFT', type: 'EXPENSE' })).toEqual({ allowed: true, needsReason: false });
  });
  it('brouillon d’un autre : refusé sans droit de modification', () => {
    expect(editPolicy({ ...c, isCreator: false, status: 'DRAFT', type: 'EXPENSE' }).allowed).toBe(false);
  });
  it('dépense soumise/autorisée : droit + motif requis', () => {
    expect(editPolicy({ ...c, status: 'APPROVED', type: 'EXPENSE' }).allowed).toBe(false);
    expect(editPolicy({ ...c, canEdit: true, status: 'APPROVED', type: 'EXPENSE' })).toEqual({ allowed: true, needsReason: true });
  });
  it('payée, contrôlée, annulée : jamais modifiable (dépense)', () => {
    for (const status of ['PAID', 'CONTROLLED', 'CANCELLED']) expect(editPolicy({ ...c, canEdit: true, status, type: 'EXPENSE' }).allowed).toBe(false);
  });
  it('recette payée : modifiable avec droit + motif ; contrôlée : non', () => {
    expect(editPolicy({ ...c, canEdit: true, status: 'PAID', type: 'INCOME' })).toEqual({ allowed: true, needsReason: true });
    expect(editPolicy({ ...c, canEdit: true, status: 'CONTROLLED', type: 'INCOME' }).allowed).toBe(false);
  });
});

import { adjustmentOutcome } from '@/lib/workflow';
describe('modification de solde : autorisation de chaque rôle', () => {
  it('reste en attente tant qu’un rôle n’a pas répondu', () => {
    expect(adjustmentOutcome(['APPROVED', 'PENDING'])).toBe('PENDING');
    expect(adjustmentOutcome(['PENDING', 'PENDING'])).toBe('PENDING');
  });
  it('autorisée uniquement quand TOUS les rôles ont autorisé', () => {
    expect(adjustmentOutcome(['APPROVED', 'APPROVED'])).toBe('APPROVED');
  });
  it('un seul refus suffit à refuser', () => {
    expect(adjustmentOutcome(['APPROVED', 'REJECTED'])).toBe('REJECTED');
    expect(adjustmentOutcome(['REJECTED', 'PENDING'])).toBe('REJECTED');
  });
  it('aucun approbateur requis ⇒ jamais autorisée', () => {
    expect(adjustmentOutcome([])).toBe('PENDING');
  });
});

import { approverRoleFor, routingBlock, describeVariance } from '@/lib/workflow';
describe('qui autorise une dépense', () => {
  it('demande de la Trésorière → Commissaire aux comptes uniquement', () => {
    expect(approverRoleFor('TRESORIERE')).toBe('CAC');
    expect(routingBlock(1, 'CAC', 'TRESORIERE')).toBeNull();
    expect(routingBlock(1, 'PRESIDENTE', 'TRESORIERE')).toMatch(/Commissaire aux comptes/);
    expect(routingBlock(1, 'TRESORIERE', 'TRESORIERE')).toMatch(/Commissaire aux comptes/);
  });
  it('demande du CAC ou de tout autre rôle → Trésorière uniquement', () => {
    for (const r of ['CAC', 'PRESIDENTE', 'SECRETAIRE', 'VICE_PRESIDENTE']) {
      expect(approverRoleFor(r)).toBe('TRESORIERE');
      expect(routingBlock(1, 'TRESORIERE', r)).toBeNull();
      expect(routingBlock(1, 'PRESIDENTE', r)).toMatch(/Trésorière/);
    }
    expect(routingBlock(1, 'CAC', 'CAC')).toMatch(/Trésorière/);
  });
  it('double validation : le 2e niveau n’est pas lié à un rôle précis', () => {
    expect(routingBlock(2, 'PRESIDENTE', 'TRESORIERE')).toBeNull();
  });
});

describe('devis vs dépense réelle', () => {
  it('aucune différence', () => expect(describeVariance(1000, 1000)).toEqual({ diff: 0, kind: 'EQUAL', pct: 0 }));
  it('dépense supérieure au devis', () => expect(describeVariance(1000, 1250)).toEqual({ diff: 250, kind: 'OVER', pct: 25 }));
  it('dépense inférieure au devis', () => expect(describeVariance(1000, 800)).toEqual({ diff: -200, kind: 'UNDER', pct: -20 }));
  it('arrondi au centime', () => expect(describeVariance(100.1, 100.3).diff).toBe(0.2));
  it('devis nul : pas de pourcentage', () => expect(describeVariance(0, 50).pct).toBeNull());
});