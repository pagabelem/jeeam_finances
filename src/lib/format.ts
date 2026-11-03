export const num = (v: unknown) => Number(v ?? 0);
export const mad = (v: unknown) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD', maximumFractionDigits: 2 }).format(num(v));
export const dt = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
export const dtt = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Brouillon', PENDING_APPROVAL: 'En attente d’autorisation', APPROVED: 'Autorisée', REJECTED: 'Refusée',
  PAID: 'Payée', CONTROLLED: 'Contrôlée', CANCELLED: 'Annulée',
};
export const STATUS_TONE: Record<string, string> = {
  DRAFT: 'gray', PENDING_APPROVAL: 'amber', APPROVED: 'blue', REJECTED: 'red', PAID: 'indigo', CONTROLLED: 'green', CANCELLED: 'gray',
};
export const OBS_LABEL: Record<string, string> = { OPEN: 'Ouverte', RESPONDED: 'Réponse fournie', VERIFIED: 'Vérifiée', CLOSED: 'Clôturée' };
export const KIND_LABEL: Record<string, string> = {
  INVOICE: 'Facture', RECEIPT: 'Reçu', BANK_STATEMENT: 'Relevé bancaire', TRANSFER_PROOF: 'Preuve de virement',
  QUOTE: 'Devis', CONTRACT: 'Contrat', OTHER: 'Autre',
};
export const ACCOUNT_LABEL: Record<string, string> = { BANK: 'Banque', CASH: 'Caisse', MOBILE_MONEY: 'Mobile money', ACTIVITY_FUND: 'Fonds d’activité' };
export const ACTIVITY_LABEL: Record<string, string> = { PLANNED: 'Planifiée', IN_PROGRESS: 'En cours', COMPLETED: 'Terminée', CANCELLED: 'Annulée' };
export const ADJ_LABEL: Record<string, string> = { PENDING: 'En attente d’autorisation', APPROVED: 'Autorisée — à appliquer', REJECTED: 'Refusée', APPLIED: 'Appliquée', CANCELLED: 'Annulée' };
export const ADJ_TONE: Record<string, string> = { PENDING: 'amber', APPROVED: 'blue', REJECTED: 'red', APPLIED: 'green', CANCELLED: 'gray' };
