import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, DEFAULT_ROLES } from '../src/lib/permissions';

const db = new PrismaClient();

async function main() {
  const existingKeys = new Set((await db.permission.findMany({ select: { key: true } })).map((p) => p.key));
  for (const p of PERMISSIONS) await db.permission.upsert({ where: { key: p.key }, update: { label: p.label, group: p.group }, create: p });
  const perms = await db.permission.findMany();
  for (const r of DEFAULT_ROLES) {
    const role = await db.role.upsert({ where: { key: r.key }, update: { name: r.name }, create: { key: r.key, name: r.name } });
    // On ne réécrit les permissions qu'à la création du rôle : les réglages faits via l'interface sont conservés.
    if ((await db.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      await db.rolePermission.createMany({ data: perms.filter((p) => r.perms.includes(p.key)).map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
  }
  // Nouvelles permissions apparues dans une version : accordées aux rôles par défaut concernés (les réglages faits via l'interface sont conservés).
  const fresh = PERMISSIONS.map((p) => p.key).filter((k) => !existingKeys.has(k));
  if (existingKeys.size && fresh.length) {
    for (const r of DEFAULT_ROLES) {
      const role = await db.role.findUnique({ where: { key: r.key } });
      if (!role) continue;
      const data = perms.filter((p) => fresh.includes(p.key) && r.perms.includes(p.key)).map((p) => ({ roleId: role.id, permissionId: p.id }));
      if (data.length) await db.rolePermission.createMany({ data, skipDuplicates: true });
    }
    console.log('Nouvelles permissions attribuées aux rôles par défaut :', fresh.join(', '));
  }
  const roles = await db.role.findMany();
  const pwd = await bcrypt.hash(process.env.SEED_PASSWORD ?? 'Jeeam@Finance2026!Secure', 12);
  const users = [
    ['presidente@jeeam.local', 'Présidente', 'PRESIDENTE'], ['vice@jeeam.local', 'Vice-président(e)', 'VICE_PRESIDENT'],
    ['secretaire@jeeam.local', 'Secrétaire', 'SECRETAIRE'], ['secretaire.adjointe@jeeam.local', 'Secrétaire adjointe', 'SECRETAIRE_ADJOINTE'],
    ['tresoriere@jeeam.local', 'Trésorière', 'TRESORIERE'], ['basile@jeeam.local', 'Pagabelem Ragnaewande Basile', 'CAC'],
  ];
  for (const [email, name, key] of users) {
    await db.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash: pwd, mustChangePassword: true, roleId: roles.find((r) => r.key === key)!.id } });
  }
  for (const [name, type] of [['Banque principale', 'BANK'], ['Caisse', 'CASH'], ['Mobile money', 'MOBILE_MONEY']] as const) {
    await db.account.upsert({ where: { name }, update: {}, create: { name, type } });
  }
  const income = ['Cotisations', 'Dons', 'Offrandes', 'Contributions régionales', 'Inscriptions aux activités', 'Subventions', 'Autres recettes'];
  const expense = ['Transport', 'Hébergement', 'Restauration', 'Matériel', 'Communication', 'Formation', 'Soutien aux régions', 'Organisation d’événements'];
  for (const name of income) await db.category.upsert({ where: { name_type: { name, type: 'INCOME' } }, update: {}, create: { name, type: 'INCOME' } });
  for (const name of expense) await db.category.upsert({ where: { name_type: { name, type: 'EXPENSE' } }, update: {}, create: { name, type: 'EXPENSE' } });
  for (const name of ['Région exemple 1', 'Région exemple 2']) await db.region.upsert({ where: { name }, update: {}, create: { name } });
  await db.setting.upsert({ where: { key: 'approvalThresholdMad' }, update: {}, create: { key: 'approvalThresholdMad', value: 2000 } });
  console.log('Seed terminé. Comptes (mot de passe initial = SEED_PASSWORD) :');
  users.forEach(([e, n]) => console.log(` - ${e}  (${n})`));
}
main().finally(() => db.$disconnect());
