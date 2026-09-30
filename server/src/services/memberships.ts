import type { Membership, Plan } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { formatDay, parseDay, todayCairo } from '../lib/dates';
import { toCents } from '../lib/pricing';
import { loadActiveClub, quotePlans } from './catalog';
import { applicantOf } from './members';
import { openCheckout } from './payments';

async function approvedMember(memberId: string) {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw notFound('Account not found');
  if (member.status !== 'APPROVED') {
    throw forbidden('not_approved', 'Your application must be approved before you can buy a membership');
  }
  return applicantOf(member);
}

/** Plans priced for this member's age today. */
export async function myPlanQuotes(memberId: string) {
  const member = applicantOf(await prisma.member.findUniqueOrThrow({ where: { id: memberId } }));
  const club = await loadActiveClub(member.clubId);
  return { currency: club.currency, ...quotePlans(club, member.dateOfBirth, parseDay(todayCairo())) };
}

/** Creates (or replaces) the member's unpaid order for a plan, priced at their current age band. */
export async function orderMembership(memberId: string, planId: string): Promise<Membership> {
  const member = await approvedMember(memberId);
  const club = await loadActiveClub(member.clubId);
  const { age, plans } = quotePlans(club, member.dateOfBirth, parseDay(todayCairo()));
  const quote = plans.find((p) => p.planId === planId);
  if (!quote) throw notFound('Plan not found');
  if (quote.price === null || !quote.ageBandId) {
    throw badRequest('plan_not_sold', 'This plan is not available for your age group');
  }

  return prisma.$transaction(async (tx) => {
    // Only one open order at a time; switching plans cancels the previous unpaid one.
    await tx.membership.updateMany({ where: { memberId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
    return tx.membership.create({
      data: { memberId, planId, ageBandId: quote.ageBandId!, ageAtPurchase: age, price: quote.price! },
    });
  });
}

export async function payMembership(memberId: string, membershipId: string) {
  const member = await approvedMember(memberId);
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.memberId !== memberId) throw notFound('Membership order not found');
  if (m.status !== 'PENDING_PAYMENT') throw conflict('not_payable', 'This membership order can no longer be paid');
  const club = await loadActiveClub(member.clubId);
  return openCheckout({
    clubId: club.id,
    target: { membershipId: m.id },
    amountCents: toCents(m.price),
    currency: club.currency,
    payer: { name: member.fullName, email: member.email, phone: member.phone },
  });
}

export async function cancelMembershipOrder(memberId: string, membershipId: string) {
  const done = await prisma.membership.updateMany({
    where: { id: membershipId, memberId, status: 'PENDING_PAYMENT' },
    data: { status: 'CANCELLED' },
  });
  if (done.count !== 1) throw conflict('not_cancellable', 'Only an unpaid order can be cancelled');
}

/** The ACTIVE card that covers `day`, if any. */
export async function membershipCovering(memberId: string, day: Date) {
  return prisma.membership.findFirst({
    where: { memberId, status: 'ACTIVE', startsAt: { lte: day }, endsAt: { gte: day } },
    include: { plan: true },
    orderBy: { endsAt: 'desc' },
  });
}

export function membershipDto(m: Membership & { plan?: Plan }) {
  return {
    id: m.id,
    planId: m.planId,
    planName: m.plan?.name ?? null,
    termMonths: m.plan?.termMonths ?? null,
    guestsPerDay: m.plan?.guestsPerDay ?? null,
    price: Number(m.price),
    ageAtPurchase: m.ageAtPurchase,
    status: m.status,
    startsAt: m.startsAt ? formatDay(m.startsAt) : null,
    endsAt: m.endsAt ? formatDay(m.endsAt) : null,
    cardNumber: m.cardNumber,
    createdAt: m.createdAt,
  };
}
