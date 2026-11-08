'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction } from '@/lib/session';
import { audit } from '@/lib/audit';
import { assertPeriodOpen } from '@/lib/domain';
import { checkConfirm, record } from '@/lib/delete';

const BACK = '/tresorerie/categories';

/** Renommer une catégorie (recette ou dépense). Le type ne change pas : il conditionne les opérations déjà classées. */
export async function updateCategory(id: string, fd: FormData) {
  await act(BACK, async () => {
    const me = await requireAction('categories.manage');
    const r = z.string().trim().min(2, 'Nom requis (2 caractères min.)').max(80).safeParse(fd.get('name'));
    if (!r.success) throw new AppError(r.error.issues[0].message);
    const c = await db.category.findUnique({ where: { id } });
    if (!c) throw new AppError('Catégorie introuvable.');
    if (c.name === r.data) throw new AppError('Aucune modification détectée.');
    const clash = await db.category.findFirst({ where: { name: r.data, type: c.type, id: { not: id } } });
    if (clash) throw new AppError('Une catégorie de ce type porte déjà ce nom.');
    await db.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { name: r.data } });
      await audit({ userId: me.id, action: 'CATEGORY_UPDATE', entity: 'Category', entityId: id, before: { name: c.name }, after: { name: r.data } }, tx);
    });
    revalidatePath('/', 'layout');
    return ok(BACK, 'Catégorie modifiée (les opérations déjà classées suivent automatiquement)');
  });
}

/**
 * Supprimer une catégorie. Si elle est utilisée (opérations, lignes budgétaires), il faut choisir une catégorie de remplacement
 * du même type : tout y est réaffecté avant la suppression. Inscrit au registre des suppressions.
 */
export async function deleteCategory(id: string, fd: FormData) {
  await act(BACK, async () => {
    const me = await requireAction('data.delete');
    const reason = checkConfirm(fd);
    const moveTo = String(fd.get('moveTo') ?? '');
    await db.$transaction(async (tx) => {
      const c = await tx.category.findUnique({ where: { id } });
      if (!c) throw new AppError('Catégorie introuvable.');
      const [txs, lines] = await Promise.all([
        tx.transaction.findMany({ where: { categoryId: id }, select: { transactionDate: true } }),
        tx.budgetLine.count({ where: { categoryId: id } }),
      ]);
      let target: string | null = null;
      if (txs.length || lines) {
        if (!moveTo) throw new AppError(`Cette catégorie est utilisée (${txs.length} opération(s), ${lines} ligne(s) budgétaire(s)) : choisissez une catégorie de remplacement.`);
        const t = await tx.category.findUnique({ where: { id: moveTo } });
        if (!t || t.id === id || t.type !== c.type) throw new AppError('La catégorie de remplacement doit être différente et du même type.');
        target = t.name;
        const dates = Array.from(new Set(txs.map((x) => x.transactionDate.toISOString().slice(0, 10))));
        for (const d of dates) await assertPeriodOpen(new Date(d), tx); // pas de reclassement dans une période verrouillée
        await tx.transaction.updateMany({ where: { categoryId: id }, data: { categoryId: moveTo } });
        await tx.budgetLine.updateMany({ where: { categoryId: id }, data: { categoryId: moveTo } });
      }
      await tx.category.delete({ where: { id } });
      await record(tx, me, { entity: 'Category', entityId: id, label: `${c.name} (${c.type === 'INCOME' ? 'recette' : 'dépense'})`, reason,
        count: 1, snapshot: { categorie: c.name, type: c.type, operationsReaffectees: txs.length, lignesBudgetairesReaffectees: lines, remplaceePar: target } });
    });
    revalidatePath('/', 'layout');
    return ok(BACK, 'Catégorie supprimée');
  });
}