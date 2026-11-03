# JEEAM Finance

Plateforme de gestion financière, contrôle interne et audit — JEEAM National.
Next.js 14 (App Router) · TypeScript · Prisma · PostgreSQL · NextAuth · Tailwind.

## Démarrage

```bash
cp .env.example .env            # puis éditer NEXTAUTH_SECRET (openssl rand -base64 32)
docker compose up -d db         # PostgreSQL local (ou utiliser votre propre instance)
npm install
npm run db:setup                # db push + triggers d'immuabilité + seed
npm run dev                     # http://localhost:3000
```

Comptes créés par le seed (mot de passe = `SEED_PASSWORD`, à changer immédiatement) :
`presidente@`, `vice@`, `secretaire@`, `secretaire.adjointe@`, `tresoriere@`, `basile@` + `jeeam.local`.

> ⚠️ Ce code a été écrit sans pouvoir exécuter `npm install` / `next build` (environnement sans réseau).
> Prévoir un premier passage `npm run build` (et `npm test`) pour corriger d'éventuelles erreurs de typage mineures.

## Ce qui est implémenté

| Module | État |
|---|---|
| Auth (NextAuth credentials, JWT 8 h, verrouillage 5 échecs/15 min) | ✅ |
| **2FA TOTP** (Google/Microsoft Authenticator, Authy…) : **obligatoire pour Trésorière et CAC** (`TOTP_REQUIRED_ROLES`), facultative pour les autres ; secret chiffré AES-256-GCM, anti-rejeu, 8 codes de secours, réinitialisation par l'admin | ✅ |
| Changement de mot de passe par l'utilisateur ; mot de passe initial / réinitialisé à changer obligatoirement à la 1re connexion | ✅ |
| RBAC configurable (permissions en base, matrice éditable, rechargées à chaque requête) | ✅ |
| Garde-fou : le Commissaire aux comptes ne peut jamais recevoir/exercer de permission opérationnelle | ✅ |
| Trésorerie : comptes, catégories configurables, recettes, numérotation `JEEAM-AAAA-NNNN`, multi-devises → MAD | ✅ |
| Circuit de dépense : Brouillon → En attente → Autorisée/Refusée → Payée → Contrôlée (+ Annulée avec motif) | ✅ |
| Séparation des pouvoirs + seuil d'auto-autorisation paramétrable (défaut 2000 MAD) | ✅ |
| **Double validation** (2 approbateurs distincts, différents du demandeur) au-delà d'un seuil paramétrable (désactivée par défaut) | ✅ |
| **Modification d'une opération** : brouillon/refusée (demandeur) ; soumise, autorisée, recette payée (droit `transactions.edit` + motif obligatoire). Une modification financière d'une dépense autorisée annule les autorisations et relance le circuit. Avant/après tracés au journal | ✅ |
| Contrôle budgétaire à la soumission (avertissement à l'approbateur) | ✅ |
| Activités, budgets par ligne, Prévision vs Réel, bilan | ✅ |
| Justificatifs : upload (PDF/JPG/PNG/WEBP ≤ 10 Mo, signature du fichier vérifiée), recherche, détection des manquants, ZIP groupé | ✅ |
| **Stockage S3** (AWS, Cloudflare R2, MinIO…) ou disque local — `STORAGE_DRIVER`, script de migration `npm run storage:migrate` | ✅ |
| Espace CAC : contrôle, observations (Ouverte→Réponse→Vérifiée→Clôturée), verrouillage/déverrouillage motivé de périodes | ✅ |
| Journal d'audit : valeurs avant/après, **chaîne de hachage SHA-256** vérifiée à l'écran, triggers SQL interdisant UPDATE/DELETE | ✅ |
| Aucune suppression d'opération (trigger SQL `DELETE` interdit) | ✅ |
| **Soldes de comptes : comptable / engagé / disponible** — un compte n'est débité qu'au paiement ; une dépense autorisée est « engagée » et réduit le disponible | ✅ |
| **Modification du solde d'un compte** : demandée par la Trésorière (motif obligatoire) → notification du Commissaire aux comptes et de la Présidente → **chacun doit autoriser** → la Trésorière est notifiée et applique. Tout est journalisé ; un seul refus bloque ; annulable avec motif | ✅ |
| **Régions (églises)** : ajout/désactivation par la Trésorière, la Secrétaire et le CAC (permission `regions.manage`) | ✅ |
| Rapports : synthèse période, par catégorie/activité/région, justificatifs manquants, export Excel + CSV + **PDF généré côté serveur** (`pdf-lib`) | ✅ |
| **Rappels planifiés** : dépenses à autoriser/payer/contrôler, observations sans réponse, cotisations régionales du mois non reçues (délais paramétrables) | ✅ |
| Notifications internes | ✅ |
| IA : assistant (recherche, **recherche sémantique**, synthèse, brouillon de dépense) ; détection d'anomalies par règles | ✅ |
| **IA à la saisie** : suggestion de catégorie (IA, avec repli sur l'historique si pas de clé), **lecture de reçu/facture** (image ou PDF) qui pré-remplit le formulaire — jamais d'enregistrement automatique | ✅ |
| Administration : utilisateurs, rôles, régions, paramètres (seuils, rappels), journal | ✅ |
| Tests automatisés (Vitest) : TOTP (vecteurs RFC), règles de validation, chaîne de hachage, signatures de fichiers, IA locale | ✅ (unitaires) |

## Mise à niveau depuis la version précédente

```bash
npm install
npx prisma db push          # ajoute : colonnes 2FA, Approval.supersededAt, table tx_embeddings
npm run db:harden
npm run db:seed             # crée les nouvelles permissions (transactions.edit, balance.*, regions.manage) et les accorde aux rôles par défaut
```

Les utilisateurs **existants** ne sont pas forcés à changer leur mot de passe ; les **Trésorière et CAC existants** devront activer
la 2FA à leur prochaine connexion (écran « Mon compte »).

## Modification de solde — fonctionnement

- Permissions : `balance.request` et `balance.apply` (Trésorière), `balance.approve` (Présidente et Commissaire aux comptes). Modifiables dans Administration > Rôles : **chaque rôle** détenant `balance.approve` doit autoriser (ex. ajouter la Vice-présidente = une autorisation de plus). Le CAC ne peut jamais recevoir `balance.request` / `balance.apply`.
- L'application ajuste le **solde initial** du compte de l'écart demandé (le solde comptable devient exactement le montant demandé). Si le solde a bougé entre la demande et l'application (nouveau paiement ou recette), l'application est refusée : annuler et refaire la demande.
- Écran : Trésorerie > Ajustements de solde. Rappels automatiques via `/api/cron/reminders`.

## 2FA — points d'attention

- Sauvegarder `TOTP_ENC_KEY` (ou `NEXTAUTH_SECRET` si elle n'est pas définie) : si elle change, les secrets 2FA deviennent illisibles → réinitialiser les 2FA depuis Administration > Utilisateurs.
- Téléphone perdu : utiliser un code de secours, ou un administrateur (CAC) clique « Réinit. 2FA » ; l'utilisateur se ré-enrôle à la connexion suivante. Chaque action est journalisée.

## Tâches planifiées

Trois endpoints protégés par `Authorization: Bearer $CRON_SECRET` : `/api/cron/anomalies`, `/api/cron/reminders`, `/api/cron/embeddings`.
- **Vercel** : `vercel.json` est fourni (anomalies 06:00, rappels 07:00). Ajouter `/api/cron/embeddings` si la recherche sémantique est utilisée.
- **Serveur / Docker** : `0 7 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://votre-domaine/api/cron/reminders`

## Migrations Prisma (avant la production)

Le démarrage (`scripts/start.sh`, utilisé par le Dockerfile) applique `prisma migrate deploy` dès que `prisma/migrations/` existe, sinon retombe sur `db push`.

1. Sur une base de dev vide, avec le schéma actuel : `npm run db:baseline` (génère `prisma/migrations/0_init/migration.sql`) puis créer `prisma/migrations/migration_lock.toml` avec `provider = "postgresql"`.
2. Base déjà déployée avec `db push` : `npx prisma migrate resolve --applied 0_init`.
3. Ensuite : `npm run db:migrate:dev` pour chaque évolution du schéma, `npm run db:migrate` en production (rejoue aussi les triggers d'immuabilité).

## Reste à faire (suite manuelle suggérée)

1. **Tests d'intégration / E2E** (Playwright + base PostgreSQL de test) : circuit complet, verrouillage de périodes, double validation. Seuls les tests unitaires de logique pure existent.
2. **Migration baseline Prisma** (voir ci-dessus) : à générer une fois, avec accès à une base.
3. **Rapports de régions attendus** : le cahier des charges ne définit pas de modèle de « rapport régional » ; seuls les rappels de cotisations par région sont automatisés.
4. **Rapports trimestriels/annuels préformatés**, rapport de contrôle / échantillons d'audit.
5. **E-mails de notification** (les notifications restent internes à l'application).
6. **Recherche sémantique à grande échelle** : le calcul de similarité est fait en mémoire (adapté à quelques milliers d'opérations) → pgvector au-delà.
7. Vérifier le premier `npm run build` : ce code a été écrit sans pouvoir exécuter `npm install` / `next build` (environnement sans réseau).

## Choix de conception à connaître

- Une **recette** est enregistrée directement au statut « Payée » (encaissée) ; le CAC la contrôle ensuite.
- Les **soldes de comptes** sont consolidés en MAD (montant converti à la saisie).
- Seule la **permission** compte, jamais le nom du rôle (sauf garde-fou CAC) : renouveler le bureau = changer les utilisateurs/rôles depuis l'interface.
- Verrouiller une période exige que toutes ses opérations soient contrôlées/annulées/refusées et toutes les observations clôturées.
- Production : définir `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, sauvegarder la base **et** le dossier `STORAGE_DIR`, servir en HTTPS (Caddy ou Vercel).
