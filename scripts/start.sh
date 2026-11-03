#!/bin/sh
# Démarrage production : applique les migrations si elles existent, sinon `db push` (premier déploiement / dev).
set -e
if [ -f prisma/migrations/migration_lock.toml ]; then
  npx prisma migrate deploy
else
  echo "⚠ Aucune migration Prisma trouvée : utilisation de 'db push' (voir README, section Migrations)."
  npx prisma db push
fi
npm run db:harden
exec npm run start
