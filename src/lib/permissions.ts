export const PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: 'dashboard.national', label: 'Tableau de bord national', group: 'Général' },
  { key: 'accounts.view', label: 'Voir les comptes et soldes', group: 'Trésorerie' },
  { key: 'accounts.manage', label: 'Gérer les comptes', group: 'Trésorerie' },
  { key: 'categories.manage', label: 'Gérer les catégories', group: 'Trésorerie' },
  { key: 'transactions.view', label: 'Voir les opérations', group: 'Trésorerie' },
  { key: 'transactions.edit', label: 'Modifier une opération déjà soumise (motif obligatoire)', group: 'Trésorerie' },
  { key: 'balance.request', label: 'Demander la modification du solde d’un compte', group: 'Trésorerie' },
  { key: 'balance.approve', label: 'Autoriser une modification de solde (chaque rôle doit autoriser)', group: 'Trésorerie' },
  { key: 'balance.apply', label: 'Appliquer une modification de solde autorisée', group: 'Trésorerie' },
  { key: 'activities.settle', label: 'Clôturer une activité (devis vs dépenses réelles, notification du bureau)', group: 'Activités' },
  { key: 'data.delete', label: 'Supprimer des données (activités, opérations, comptes, justificatifs, observations, notifications)', group: 'Suppressions' },
  { key: 'audit.purge', label: 'Supprimer des entrées du journal d’audit (individuel, par critère, tout)', group: 'Suppressions' },
  { key: 'transactions.cancel', label: 'Annuler une opération (motif obligatoire)', group: 'Trésorerie' },
  { key: 'income.record', label: 'Enregistrer des recettes', group: 'Trésorerie' },
  { key: 'expenses.request', label: 'Créer des demandes de dépense', group: 'Dépenses' },
  { key: 'expenses.approve', label: 'Autoriser / refuser des dépenses', group: 'Dépenses' },
  { key: 'expenses.pay', label: 'Exécuter les paiements', group: 'Dépenses' },
  { key: 'attachments.view', label: 'Consulter les justificatifs', group: 'Justificatifs' },
  { key: 'attachments.upload', label: 'Ajouter des justificatifs', group: 'Justificatifs' },
  { key: 'activities.view', label: 'Voir les activités', group: 'Activités' },
  { key: 'activities.manage', label: 'Gérer activités et budgets', group: 'Activités' },
  { key: 'audit.view', label: 'Accès espace audit (lecture globale)', group: 'Audit' },
  { key: 'audit.control', label: 'Valider le contrôle d’une opération', group: 'Audit' },
  { key: 'audit.observe', label: 'Ouvrir / clôturer des observations', group: 'Audit' },
  { key: 'audit.lock', label: 'Verrouiller des périodes', group: 'Audit' },
  { key: 'observations.respond', label: 'Répondre aux observations', group: 'Audit' },
  { key: 'reports.view', label: 'Rapports et exports', group: 'Rapports' },
  { key: 'ai.use', label: 'Assistant IA', group: 'IA' },
  { key: 'admin.users', label: 'Gérer les utilisateurs', group: 'Administration' },
  { key: 'admin.roles', label: 'Gérer rôles et permissions', group: 'Administration' },
  { key: 'admin.regions', label: 'Gérer le référentiel des régions', group: 'Administration' },
  { key: 'regions.manage', label: 'Ajouter / désactiver des églises régionales', group: 'Trésorerie' },
  { key: 'admin.auditlog', label: 'Consulter le journal d’audit', group: 'Administration' },
  { key: 'admin.settings', label: 'Paramètres (seuils)', group: 'Administration' },
];

const READ = ['accounts.view', 'transactions.view', 'attachments.view', 'activities.view', 'reports.view', 'dashboard.national'];

export const DEFAULT_ROLES: { key: string; name: string; perms: string[] }[] = [
  { key: 'PRESIDENTE', name: 'Présidente', perms: [...READ, 'expenses.approve', 'balance.approve', 'observations.respond', 'ai.use'] },
  { key: 'VICE_PRESIDENT', name: 'Vice-président(e)', perms: [...READ, 'expenses.approve'] },
  { key: 'SECRETAIRE', name: 'Secrétaire', perms: ['activities.view', 'activities.manage', 'reports.view', 'regions.manage'] },
  { key: 'SECRETAIRE_ADJOINTE', name: 'Secrétaire adjointe', perms: ['activities.view', 'activities.manage'] },
  {
    key: 'TRESORIERE', name: 'Trésorière',
    perms: [...READ, 'accounts.manage', 'categories.manage', 'regions.manage', 'balance.request', 'balance.apply', 'activities.settle', 'data.delete', 'audit.purge', 'transactions.edit', 'transactions.cancel', 'income.record', 'expenses.request',
      'expenses.approve', 'expenses.pay', 'attachments.upload', 'activities.manage', 'observations.respond', 'ai.use'],
  },
  {
    key: 'CAC', name: 'Commissaire aux comptes',
    perms: [...READ, 'categories.manage', 'regions.manage', 'balance.approve', 'expenses.request', 'expenses.approve', 'data.delete', 'audit.purge', 'audit.view', 'audit.control', 'audit.observe', 'audit.lock', 'ai.use',
      'admin.users', 'admin.roles', 'admin.regions', 'admin.auditlog', 'admin.settings'],
  },
];

/** Permissions opérationnelles que le Commissaire aux comptes ne doit JAMAIS détenir (garde-fou en dur). */
export const AUDITOR_FORBIDDEN = [
  'income.record', 'expenses.pay', 'transactions.edit', 'transactions.cancel', 'attachments.upload', 'accounts.manage', 'balance.request', 'balance.apply', 'activities.settle',
];

/** Rôles pour lesquels la double authentification (TOTP) est obligatoire. */
export const TOTP_REQUIRED_ROLES = ['TRESORIERE', 'CAC'];