// Règles pures du circuit de validation (testables sans base de données).

/** Nombre d'autorisations distinctes requises : 2 au-delà du seuil de double validation (si activé), sinon 1. */
export function requiredApprovals(amountMad: number, doubleThreshold: number | null): 1 | 2 {
  return doubleThreshold != null && doubleThreshold > 0 && amountMad > doubleThreshold ? 2 : 1;
}

export type ApprovalCtx = {
  userId: string; creatorId: string; amountMad: number;
  threshold: number;            // seuil d'auto-autorisation
  doubleThreshold: number | null;
  approvedBy: string[];         // approbateurs ayant déjà autorisé (versions non invalidées)
};

/** Retourne un message d'erreur si `userId` ne peut pas autoriser, sinon null. */
export function approvalBlock(c: ApprovalCtx): string | null {
  if (c.approvedBy.includes(c.userId)) return 'Vous avez déjà autorisé cette dépense : un second approbateur distinct est requis.';
  const required = requiredApprovals(c.amountMad, c.doubleThreshold);
  if (c.userId === c.creatorId && (c.amountMad > c.threshold || required > 1)) {
    return required > 1
      ? 'Double validation : le demandeur ne peut pas autoriser sa propre dépense.'
      : 'Au-delà du seuil, l’autorisation doit être donnée par une personne distincte du demandeur.';
  }
  return null;
}

export type EditCtx = { status: string; type: 'INCOME' | 'EXPENSE'; isCreator: boolean; canRequest: boolean; canEdit: boolean };

/** Droit de modification selon l'état. `needsReason` : motif obligatoire (tracé dans le journal). */
export function editPolicy(c: EditCtx): { allowed: boolean; needsReason: boolean; why?: string } {
  const own = c.isCreator && c.canRequest;
  if (c.type === 'EXPENSE') {
    if (c.status === 'DRAFT' || c.status === 'REJECTED') {
      return (own || c.canEdit) ? { allowed: true, needsReason: false } : { allowed: false, needsReason: false, why: 'Seul le demandeur (ou un titulaire du droit de modification) peut modifier ce brouillon.' };
    }
    if (c.status === 'PENDING_APPROVAL' || c.status === 'APPROVED') {
      return c.canEdit ? { allowed: true, needsReason: true } : { allowed: false, needsReason: true, why: 'Droit de modification requis pour une dépense déjà soumise.' };
    }
  } else if (c.status === 'PAID') {
    return c.canEdit ? { allowed: true, needsReason: true } : { allowed: false, needsReason: true, why: 'Droit de modification requis.' };
  }
  return { allowed: false, needsReason: false, why: 'Cette opération n’est plus modifiable (payée, contrôlée ou annulée) : annulez-la avec motif puis ressaisissez-la.' };
}

export type AdjDecision = 'PENDING' | 'APPROVED' | 'REJECTED';
/** État global d'une modification de solde : refusée si un seul rôle refuse, autorisée quand TOUS les rôles requis ont autorisé. */
export function adjustmentOutcome(decisions: AdjDecision[]): 'REJECTED' | 'APPROVED' | 'PENDING' {
  if (decisions.some((d) => d === 'REJECTED')) return 'REJECTED';
  if (decisions.length > 0 && decisions.every((d) => d === 'APPROVED')) return 'APPROVED';
  return 'PENDING';
}
