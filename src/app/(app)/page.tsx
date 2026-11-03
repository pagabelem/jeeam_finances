import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { accountBalances } from '@/lib/domain';
import { mad, num, dt } from '@/lib/format';
import { Flash, PageHeader, Stat, Progress, Empty } from '@/components/ui';
import { MonthlyChart } from '@/components/client';

export default async function Dashboard({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePage();
  const national = user.perms.has('dashboard.national');
  const auditor = user.perms.has('audit.view');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const valid = { status: { in: ['PAID', 'CONTROLLED'] as ('PAID' | 'CONTROLLED')[] } };
  const [balances, monthAgg, series, pendingApproval, noProof, activities, byRegion] = national ? await Promise.all([
    accountBalances(),
    db.transaction.groupBy({ by: ['type'], where: { ...valid, transactionDate: { gte: monthStart } }, _sum: { amountMad: true } }),
    db.transaction.findMany({ where: { ...valid, transactionDate: { gte: yearAgo } }, select: { type: true, amountMad: true, transactionDate: true } }),
    db.transaction.count({ where: { status: 'PENDING_APPROVAL' } }),
    db.transaction.count({ where: { type: 'EXPENSE', status: { in: ['PAID', 'CONTROLLED'] }, attachments: { none: {} } } }),
    db.activity.findMany({ where: { status: { in: ['PLANNED', 'IN_PROGRESS'] } }, include: { budgets: { include: { lines: true } } }, take: 6, orderBy: { startDate: 'asc' } }),
    db.transaction.groupBy({ by: ['regionId'], where: { ...valid, type: 'INCOME', regionId: { not: null } }, _sum: { amountMad: true } }),
  ]) : [[], [], [], 0, 0, [], []] as never[];

  const total = (balances as { balance: number }[]).reduce((s, a) => s + a.balance, 0);
  const committedTotal = (balances as { committed: number }[]).reduce((s, a) => s + a.committed, 0);
  const inc = num((monthAgg as { type: string; _sum: { amountMad: unknown } }[]).find((m) => m.type === 'INCOME')?._sum.amountMad);
  const exp = num((monthAgg as { type: string; _sum: { amountMad: unknown } }[]).find((m) => m.type === 'EXPENSE')?._sum.amountMad);

  const months: { key: string; month: string; recettes: number; depenses: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, month: d.toLocaleDateString('fr-FR', { month: 'short' }), recettes: 0, depenses: 0 });
  }
  for (const t of series as { type: string; amountMad: unknown; transactionDate: Date }[]) {
    const m = months.find((x) => x.key === `${t.transactionDate.getFullYear()}-${t.transactionDate.getMonth()}`);
    if (m) m[t.type === 'INCOME' ? 'recettes' : 'depenses'] += num(t.amountMad);
  }

  const regions = await db.region.findMany();
  const actUsage = await Promise.all((activities as { id: string; name: string; endDate: Date; budgets: { lines: { planned: unknown }[] }[] }[]).map(async (a) => {
    const planned = a.budgets.flatMap((b) => b.lines).reduce((s, l) => s + num(l.planned), 0);
    const agg = await db.transaction.aggregate({ _sum: { amountMad: true }, where: { activityId: a.id, type: 'EXPENSE', status: { in: ['APPROVED', 'PAID', 'CONTROLLED'] } } });
    return { ...a, planned, spent: num(agg._sum.amountMad) };
  }));

  let audit = { toControl: 0, controlled: 0, noProof: 0, open: 0, responded: 0, closed: 0, last: null as Date | null };
  if (auditor) {
    const [toControl, controlled, np, obs, last] = await Promise.all([
      db.transaction.count({ where: { status: 'PAID' } }), db.transaction.count({ where: { status: 'CONTROLLED' } }),
      db.transaction.count({ where: { type: 'EXPENSE', status: { in: ['PAID', 'CONTROLLED'] }, attachments: { none: {} } } }),
      db.auditObservation.groupBy({ by: ['status'], _count: true }),
      db.transaction.findFirst({ where: { controlledAt: { not: null } }, orderBy: { controlledAt: 'desc' }, select: { controlledAt: true } }),
    ]);
    const c = (s: string) => obs.find((o) => o.status === s)?._count ?? 0;
    audit = { toControl, controlled, noProof: np, open: c('OPEN'), responded: c('RESPONDED') + c('VERIFIED'), closed: c('CLOSED'), last: last?.controlledAt ?? null };
  }

  return (
    <>
      <PageHeader title={`Bonjour ${user.name.split(' ')[0]}`} sub={`${user.roleName} — ${now.toLocaleDateString('fr-FR', { dateStyle: 'full' })}`} />
      <Flash error={searchParams.error} />
      {!national && !auditor && <div className="card"><Empty text="Utilisez le menu pour accéder à vos modules." /></div>}

      {national && (
        <section className="mb-8 space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label={committedTotal ? `Trésorerie totale (dont ${mad(committedTotal)} engagés)` : 'Trésorerie totale'} value={mad(total)} />
            <Stat label="Recettes du mois" value={mad(inc)} tone="green" />
            <Stat label="Dépenses du mois" value={mad(exp)} tone="red" />
            <Stat label="À autoriser / sans justificatif" value={`${pendingApproval} / ${noProof}`} tone={pendingApproval + noProof ? 'amber' : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2"><h2 className="mb-3 font-semibold">Évolution mensuelle (12 mois)</h2><MonthlyChart data={months} /></div>
            <div className="card"><h2 className="mb-3 font-semibold">Soldes par compte</h2>
              {(balances as { id: string; name: string; balance: number; committed: number }[]).map((a) => (
                <div key={a.id} className="flex justify-between border-b border-slate-100 py-2 text-sm"><span>{a.name}{a.committed > 0 && <span className="ml-1 text-xs text-amber-700">(engagé {mad(a.committed)})</span>}</span><span className="font-medium">{mad(a.balance)}</span></div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h2 className="mb-3 font-semibold">Activités — consommation du budget</h2>
              {!actUsage.length && <Empty text="Aucune activité en cours." />}
              {actUsage.map((a) => (
                <Link href={`/activites/${a.id}`} key={a.id} className="mb-3 block">
                  <div className="flex justify-between text-sm"><span>{a.name}</span><span className="text-slate-500">{mad(a.spent)} / {mad(a.planned)}</span></div>
                  <Progress value={a.planned ? (a.spent / a.planned) * 100 : 0} />
                </Link>
              ))}
            </div>
            <div className="card"><h2 className="mb-3 font-semibold">Contributions par région d’origine</h2>
              {!(byRegion as unknown[]).length && <Empty text="Aucune contribution régionale enregistrée." />}
              {(byRegion as { regionId: string; _sum: { amountMad: unknown } }[]).map((r) => (
                <div key={r.regionId} className="flex justify-between border-b border-slate-100 py-2 text-sm">
                  <span>{regions.find((x) => x.id === r.regionId)?.name}</span><span className="font-medium">{mad(r._sum.amountMad)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {auditor && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Contrôle & audit</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="À contrôler" value={audit.toControl} tone={audit.toControl ? 'amber' : undefined} />
            <Stat label="Contrôlées" value={audit.controlled} tone="green" />
            <Stat label="Sans justificatif" value={audit.noProof} tone={audit.noProof ? 'red' : undefined} />
            <Stat label="Observations ouvertes / en réponse / closes" value={`${audit.open} / ${audit.responded} / ${audit.closed}`} />
          </div>
          <p className="mt-3 text-sm text-slate-500">Dernier contrôle : {dt(audit.last)}</p>
        </section>
      )}
    </>
  );
}
