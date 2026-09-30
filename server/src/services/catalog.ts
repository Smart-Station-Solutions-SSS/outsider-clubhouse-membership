import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { notFound } from '../lib/errors';
import { ageOn } from '../lib/national-id';
import { bandForAge, fromCents, guestPriceCents, toCents } from '../lib/pricing';
import { managedBySss } from './catalog-sync';

const clubInclude = {
  ageBands: { where: { archived: false }, orderBy: { minAge: 'asc' } },
  plans: { where: { isActive: true }, orderBy: [{ termMonths: 'asc' }, { name: 'asc' }], include: { prices: true } },
  dayUseFees: true,
  guestFees: true,
} satisfies Prisma.ClubInclude;

export type ClubWithCatalog = Prisma.ClubGetPayload<{ include: typeof clubInclude }>;

/** A club whose prices come from SSS sells nothing until the first successful sync — never stale local rows. */
function gateUnsynced(club: ClubWithCatalog): ClubWithCatalog {
  return managedBySss(club) && !club.catalogSyncedAt ? { ...club, plans: [], dayUseFees: [], guestFees: [] } : club;
}

export async function loadClub(clubId: string): Promise<ClubWithCatalog> {
  const club = await prisma.club.findUnique({ where: { id: clubId }, include: clubInclude });
  if (!club) throw notFound('Club not found');
  return gateUnsynced(club);
}

export async function loadActiveClub(clubId: string): Promise<ClubWithCatalog> {
  const club = await loadClub(clubId);
  if (!club.isActive) throw notFound('Club not found');
  return club;
}

export async function loadClubBySssCommunity(sssCommunityId: string): Promise<ClubWithCatalog> {
  const club = await prisma.club.findUnique({ where: { sssCommunityId }, include: clubInclude });
  if (!club || !club.isActive) throw notFound('No clubhouse is linked to this community');
  return gateUnsynced(club);
}

export type PlanQuote = {
  planId: string;
  name: string;
  description: string | null;
  termMonths: number;
  guestsPerDay: number;
  ageBandId: string | null;
  ageBandLabel: string | null;
  /** null = not sold to this person's age band */
  price: number | null;
};

export function quotePlans(club: ClubWithCatalog, dateOfBirth: Date, on: Date): { age: number; plans: PlanQuote[] } {
  const age = ageOn(dateOfBirth, on);
  const band = bandForAge(club.ageBands, age);
  return {
    age,
    plans: club.plans.map((p) => {
      const cell = band ? p.prices.find((c) => c.ageBandId === band.id) : undefined;
      return {
        planId: p.id,
        name: p.name,
        description: p.description,
        termMonths: p.termMonths,
        guestsPerDay: p.guestsPerDay,
        ageBandId: band?.id ?? null,
        ageBandLabel: band?.label ?? null,
        price: cell ? Number(cell.price) : null,
      };
    }),
  };
}

export type VisitQuote = { age: number; ageBandId: string | null; ageBandLabel: string | null; priceCents: number | null };

/** Guests pay the dashboard's guest fees when the club has any, else the day-use fee minus the discount. */
export const usesGuestFees = (club: ClubWithCatalog) => club.guestFees.length > 0;

/** A member's guest price per age band, youngest first (empty when the club uses the discount). */
export function guestFeeList(club: ClubWithCatalog) {
  return club.ageBands.flatMap((b) => {
    const fee = club.guestFees.find((f) => f.ageBandId === b.id);
    return fee ? [{ ageBandId: b.id, ageBandLabel: b.label, price: Number(fee.price) }] : [];
  });
}

/** Day-use price for one person on the visit day, or a member's guest price. */
export function quoteVisit(club: ClubWithCatalog, dateOfBirth: Date, visitDate: Date, asGuest: boolean): VisitQuote {
  const age = ageOn(dateOfBirth, visitDate);
  const band = bandForAge(club.ageBands, age);
  let priceCents: number | null = null;
  if (band && asGuest && usesGuestFees(club)) {
    const fee = club.guestFees.find((f) => f.ageBandId === band.id);
    priceCents = fee ? toCents(fee.price) : null;
  } else if (band) {
    const fee = club.dayUseFees.find((f) => f.ageBandId === band.id);
    const base = fee ? toCents(fee.price) : null;
    priceCents = base === null ? null : asGuest ? guestPriceCents(base, club.guestDiscountPercent) : base;
  }
  return { age, ageBandId: band?.id ?? null, ageBandLabel: band?.label ?? null, priceCents };
}

/** What anyone may see before signing up. */
export function publicCatalog(club: ClubWithCatalog) {
  return {
    id: club.id,
    name: club.name,
    currency: club.currency,
    membershipApproval: club.membershipApproval,
    dayUseApproval: club.dayUseApproval,
    guestDiscountPercent: club.guestDiscountPercent,
    ageBands: club.ageBands.map((b) => ({ id: b.id, label: b.label, minAge: b.minAge, maxAge: b.maxAge })),
    plans: club.plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      termMonths: p.termMonths,
      guestsPerDay: p.guestsPerDay,
      prices: p.prices.map((c) => ({ ageBandId: c.ageBandId, price: Number(c.price) })),
    })),
    dayUseFees: club.dayUseFees.map((f) => ({ ageBandId: f.ageBandId, price: Number(f.price) })),
    /** Empty = guests pay the day-use fee minus guestDiscountPercent. */
    guestFees: club.guestFees.map((f) => ({ ageBandId: f.ageBandId, price: Number(f.price) })),
  };
}

export const money = (cents: number) => fromCents(cents);
