import { config } from '../config';
import { prisma } from '../db';
import { parseDay, todayCairo } from '../lib/dates';
import { syncAllClubs } from './catalog-sync';

// Housekeeping, run every 15 minutes: expire finished cards/passes and release
// unpaid orders so they don't hold guest slots or show as open forever.

export async function runHousekeeping(now: Date = new Date()) {
  const today = parseDay(todayCairo(now));
  const holdCutoff = new Date(now.getTime() - config.PAYMENT_HOLD_MINUTES * 60 * 1000);
  const checkoutGrace = new Date(now.getTime() - 60 * 60 * 1000);

  const expiredCards = await prisma.membership.updateMany({
    where: { status: 'ACTIVE', endsAt: { lt: today } },
    data: { status: 'EXPIRED' },
  });
  const expiredPasses = await prisma.pass.updateMany({
    where: { status: 'ACTIVE', visitDate: { lt: today } },
    data: { status: 'EXPIRED' },
  });

  // Unpaid membership orders older than the hold — unless a checkout was opened in the last hour.
  const staleOrders = await prisma.membership.updateMany({
    where: {
      status: 'PENDING_PAYMENT',
      createdAt: { lt: holdCutoff },
      payments: { none: { status: 'PENDING', createdAt: { gt: checkoutGrace } } },
    },
    data: { status: 'CANCELLED' },
  });

  // Visit requests whose day has passed without being paid (or reviewed).
  const staleVisits = await prisma.visitRequest.findMany({
    where: { status: { in: ['PENDING_REVIEW', 'APPROVED'] }, visitDate: { lt: today } },
    select: { id: true },
  });
  if (staleVisits.length) {
    const ids = staleVisits.map((v) => v.id);
    await prisma.$transaction([
      prisma.visitRequest.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED' } }),
      prisma.pass.updateMany({ where: { requestId: { in: ids }, status: { in: ['PENDING_REVIEW', 'PENDING_PAYMENT'] } }, data: { status: 'CANCELLED' } }),
    ]);
  }
  return { expiredCards: expiredCards.count, expiredPasses: expiredPasses.count, staleOrders: staleOrders.count, staleVisits: staleVisits.length };
}

export function startJobs() {
  const tick = () => runHousekeeping().catch((err) => console.error('[jobs] housekeeping failed', err));
  const sync = () => syncAllClubs().catch((err) => console.error('[jobs] catalog sync failed', err));
  tick();
  sync();
  // Plans and prices are edited in SSS; pull them every 5 minutes.
  return [setInterval(tick, 15 * 60 * 1000), setInterval(sync, 5 * 60 * 1000)];
}
