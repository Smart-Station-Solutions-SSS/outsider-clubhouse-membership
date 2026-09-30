import type { ApprovalMode, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { validateBands } from '../lib/pricing';
import { loadClub, publicCatalog } from './catalog';
import { assertLocallyManaged, managedBySss, syncClubCatalog } from './catalog-sync';

// Club configuration managed from the SSS admin dashboard.

export async function listClubs() {
  return prisma.club.findMany({ orderBy: { createdAt: 'asc' } });
}

export async function createClub(input: { name: string; sssCommunityId?: string | null; currency?: string }) {
  if (input.sssCommunityId && (await prisma.club.findUnique({ where: { sssCommunityId: input.sssCommunityId } }))) {
    throw conflict('community_linked', 'A club is already linked to this SSS community');
  }
  return prisma.club.create({
    data: { name: input.name.trim(), sssCommunityId: input.sssCommunityId || null, currency: input.currency ?? 'EGP' },
  });
}

export async function updateClub(
  clubId: string,
  input: Partial<{
    name: string;
    sssCommunityId: string | null;
    isActive: boolean;
    membershipApproval: ApprovalMode;
    dayUseApproval: ApprovalMode;
    guestDiscountPercent: number;
    outsiderGuestsPerDay: number;
    sssFacilityId: string | null;
  }>,
) {
  const before = await loadClub(clubId);
  let club;
  try {
    club = await prisma.club.update({ where: { id: clubId }, data: input });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw conflict('community_linked', 'A club is already linked to this SSS community');
    throw err;
  }
  // SSS plans carry no outsider guest allowance; the club setting is copied onto each synced plan.
  if (input.outsiderGuestsPerDay !== undefined) {
    await prisma.plan.updateMany({ where: { clubId, sssId: { not: null } }, data: { guestsPerDay: input.outsiderGuestsPerDay } });
  }
  const relinked = before.sssCommunityId !== club.sssCommunityId || before.sssFacilityId !== club.sssFacilityId;
  if (relinked && managedBySss(club)) {
    // Pull the new catalog now; a failure is recorded on the club and retried by the job.
    await syncClubCatalog(clubId).catch(() => undefined);
    club = await prisma.club.findUniqueOrThrow({ where: { id: clubId } });
  }
  return club;
}

export async function adminCatalog(clubId: string) {
  const club = await loadClub(clubId);
  const inactive = await prisma.plan.findMany({ where: { clubId, isActive: false }, include: { prices: true } });
  const base = publicCatalog(club);
  return {
    ...base,
    sssCommunityId: club.sssCommunityId,
    isActive: club.isActive,
    catalogManagedBySss: managedBySss(club),
    plans: [
      ...base.plans.map((p) => ({ ...p, isActive: true })),
      ...inactive.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        termMonths: p.termMonths,
        guestsPerDay: p.guestsPerDay,
        isActive: false,
        prices: p.prices.map((c) => ({ ageBandId: c.ageBandId, price: Number(c.price) })),
      })),
    ],
  };
}

/**
 * Replaces the club's age bands. Bands keep their id when `id` is passed; a removed band
 * takes its plan/day-use prices with it, but not bands already used by a sold card or pass.
 */
export async function replaceAgeBands(clubId: string, bands: { id?: string; label: string; minAge: number; maxAge: number | null }[]) {
  await assertLocallyManaged(clubId);
  const problem = validateBands(bands);
  if (problem) throw badRequest('invalid_age_bands', problem);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.ageBand.findMany({ where: { clubId } });
    const keep = new Set(bands.filter((b) => b.id).map((b) => b.id!));
    for (const b of bands) {
      if (b.id && !existing.some((e) => e.id === b.id)) throw badRequest('unknown_band', `Unknown age band ${b.id}`);
    }
    const removed = existing.filter((e) => !keep.has(e.id));
    if (removed.length) {
      const inUse =
        (await tx.membership.count({ where: { ageBandId: { in: removed.map((r) => r.id) } } })) +
        (await tx.pass.count({ where: { ageBandId: { in: removed.map((r) => r.id) } } }));
      if (inUse) throw conflict('band_in_use', 'An age band that was already sold cannot be removed; edit its ages instead');
      await tx.ageBand.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
    }
    for (const b of bands) {
      const data = { label: b.label.trim(), minAge: b.minAge, maxAge: b.maxAge };
      if (b.id) await tx.ageBand.update({ where: { id: b.id }, data });
      else await tx.ageBand.create({ data: { ...data, clubId } });
    }
    return tx.ageBand.findMany({ where: { clubId }, orderBy: { minAge: 'asc' } });
  });
}

type PriceCell = { ageBandId: string; price: number | null };

async function assertBandsBelong(tx: Prisma.TransactionClient, clubId: string, cells: PriceCell[]) {
  const ids = [...new Set(cells.map((c) => c.ageBandId))];
  const n = await tx.ageBand.count({ where: { clubId, id: { in: ids } } });
  if (n !== ids.length) throw badRequest('unknown_band', 'A price refers to an age band of another club');
}

export type PlanInput = {
  name: string;
  description?: string | null;
  termMonths: number;
  guestsPerDay: number;
  isActive?: boolean;
  /** price null (or a missing band) = not sold to that band */
  prices: PriceCell[];
};

export async function createPlan(clubId: string, input: PlanInput) {
  await assertLocallyManaged(clubId);
  return prisma.$transaction(async (tx) => {
    await assertBandsBelong(tx, clubId, input.prices);
    return tx.plan.create({
      data: {
        clubId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        termMonths: input.termMonths,
        guestsPerDay: input.guestsPerDay,
        isActive: input.isActive ?? true,
        prices: { create: input.prices.filter((c) => c.price !== null).map((c) => ({ ageBandId: c.ageBandId, price: c.price! })) },
      },
      include: { prices: true },
    });
  });
}

export async function updatePlan(clubId: string, planId: string, input: Partial<PlanInput>) {
  await assertLocallyManaged(clubId);
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || plan.clubId !== clubId) throw notFound('Plan not found');
  return prisma.$transaction(async (tx) => {
    if (input.prices) {
      await assertBandsBelong(tx, clubId, input.prices);
      await tx.planPrice.deleteMany({ where: { planId } });
      const rows = input.prices.filter((c) => c.price !== null).map((c) => ({ planId, ageBandId: c.ageBandId, price: c.price! }));
      if (rows.length) await tx.planPrice.createMany({ data: rows });
    }
    return tx.plan.update({
      where: { id: planId },
      data: {
        name: input.name?.trim(),
        description: input.description === undefined ? undefined : input.description?.trim() || null,
        termMonths: input.termMonths,
        guestsPerDay: input.guestsPerDay,
        isActive: input.isActive,
      },
      include: { prices: true },
    });
  });
}

/** Sold plans are archived (isActive=false) rather than deleted, so paid cards keep their plan. */
export async function deletePlan(clubId: string, planId: string) {
  await assertLocallyManaged(clubId);
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || plan.clubId !== clubId) throw notFound('Plan not found');
  const sold = await prisma.membership.count({ where: { planId } });
  if (sold) {
    await prisma.plan.update({ where: { id: planId }, data: { isActive: false } });
    return { archived: true };
  }
  await prisma.plan.delete({ where: { id: planId } });
  return { deleted: true };
}

export async function replaceDayUseFees(clubId: string, cells: PriceCell[]) {
  await assertLocallyManaged(clubId);
  return prisma.$transaction(async (tx) => {
    await assertBandsBelong(tx, clubId, cells);
    await tx.dayUseFee.deleteMany({ where: { clubId } });
    const rows = cells.filter((c) => c.price !== null).map((c) => ({ clubId, ageBandId: c.ageBandId, price: c.price! }));
    if (rows.length) await tx.dayUseFee.createMany({ data: rows });
    return tx.dayUseFee.findMany({ where: { clubId } });
  });
}
