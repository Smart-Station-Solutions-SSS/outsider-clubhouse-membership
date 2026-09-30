import type { Prisma } from '@prisma/client';
import { addDays, addMonths, parseDay, todayCairo } from '../lib/dates';
import { randomToken } from '../lib/pii';

// What a completed payment turns on. Every update is conditional on the current
// status, so a webhook delivered twice (or racing the mock page) is a no-op.

export async function activateMembership(tx: Prisma.TransactionClient, membershipId: string): Promise<boolean> {
  const m = await tx.membership.findUnique({ where: { id: membershipId }, include: { plan: true } });
  if (!m || m.status !== 'PENDING_PAYMENT') return false;

  // A renewal starts the day after the member's current card ends, so no paid day is lost.
  const today = parseDay(todayCairo());
  const current = await tx.membership.findFirst({
    where: { memberId: m.memberId, status: 'ACTIVE', endsAt: { gte: today } },
    orderBy: { endsAt: 'desc' },
  });
  const startsAt = current?.endsAt ? addDays(current.endsAt, 1) : today;
  const endsAt = addDays(addMonths(startsAt, m.plan.termMonths), -1);

  const done = await tx.membership.updateMany({
    where: { id: membershipId, status: 'PENDING_PAYMENT' },
    data: { status: 'ACTIVE', startsAt, endsAt, cardNumber: `OCM-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}` },
  });
  return done.count === 1;
}

export async function activateVisitRequest(tx: Prisma.TransactionClient, requestId: string): Promise<boolean> {
  const done = await tx.visitRequest.updateMany({ where: { id: requestId, status: 'APPROVED' }, data: { status: 'PAID' } });
  if (done.count !== 1) return false;
  const passes = await tx.pass.findMany({ where: { requestId, status: 'PENDING_PAYMENT' } });
  for (const p of passes) {
    await tx.pass.update({ where: { id: p.id }, data: { status: 'ACTIVE', qrToken: `CH-${randomToken(18)}` } });
  }
  return true;
}
