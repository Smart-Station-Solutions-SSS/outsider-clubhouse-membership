import type { Club } from '@prisma/client';
import { prisma } from '../db';
import { conflict, notFound } from '../lib/errors';
import { validateBands } from '../lib/pricing';
import { sss, sssSyncConfigured, type SssCatalog } from '../lib/sss';

// Plans, age bands and prices are managed in the SSS admin dashboard (Clubhouse →
// plans, age bands, entry fees). A club linked to an SSS community mirrors them here:
//   - age bands          ← MembershipAgeBand (active)
//   - plans + prices     ← ClubhouseMembershipPlan + its OUTSIDE price column; guests a day from
//                          the plan's outsiderGuestLimit, else the club's outsiderGuestsPerDay
//   - day-use fees       ← ClubhouseEntryFee, fee group OUTSIDER, for the club's facility
//   - member guest fees  ← ClubhouseEntryFee, fee group GUEST, for the club's facility
//                          (until SSS sends them, guests pay the day-use fee minus the discount)
// A plan with no OUTSIDE price is not sold to outsiders and is hidden. Rows that a sold
// card or pass still points at are archived instead of deleted.

export const managedBySss = (club: Pick<Club, 'sssCommunityId'>) => sssSyncConfigured() && Boolean(club.sssCommunityId);

export async function assertLocallyManaged(clubId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw notFound('Club not found');
  if (managedBySss(club)) {
    throw conflict('catalog_managed_by_sss', 'Plans, age bands and prices for this club are managed in the SSS dashboard (Clubhouse)');
  }
}

/** The SSS facility whose plans and outsider entry fees this club sells. */
export function pickFacility(cat: SssCatalog, configured: string | null): string | null {
  if (configured) return configured;
  const withFees = [...new Set(cat.outsiderEntryFees.map((f) => f.facilityId))];
  if (withFees.length === 1) return withFees[0];
  const withPlans = [...new Set(cat.plans.filter((p) => p.outsidePrices.length && p.facilityId).map((p) => p.facilityId!))];
  return withPlans.length === 1 ? withPlans[0] : null;
}

export type SyncSummary = {
  facilityId: string | null;
  ageBands: number;
  plansOnSale: number;
  plansHidden: number;
  dayUseFees: number;
  guestFees: number;
  syncedAt: Date;
};

export async function syncClubCatalog(clubId: string): Promise<SyncSummary> {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw notFound('Club not found');
  if (!managedBySss(club)) throw conflict('not_linked', 'This club is not linked to an SSS community, or SSS sync is not configured');

  try {
    const cat = await sss.fetchCatalog(club.sssCommunityId!);
    const summary = await applyCatalog(club, cat);
    await prisma.club.update({ where: { id: club.id }, data: { catalogSyncedAt: summary.syncedAt, catalogSyncError: null } });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.club.update({ where: { id: club.id }, data: { catalogSyncError: message.slice(0, 500) } });
    throw err;
  }
}

async function applyCatalog(club: Club, cat: SssCatalog): Promise<SyncSummary> {
  const problem = validateBands(cat.ageBands.map((b) => ({ minAge: b.minAgeYears, maxAge: b.maxAgeYears })));
  if (problem) throw conflict('sss_bands_invalid', `SSS age bands are not usable: ${problem}`);

  const facilityId = pickFacility(cat, club.sssFacilityId);
  const planCovers = (p: SssCatalog['plans'][number]) => !facilityId || !p.facilityId || p.facilityId === facilityId;
  const fees = facilityId ? cat.outsiderEntryFees.filter((f) => f.facilityId === facilityId) : [];
  const guestFees = facilityId ? (cat.guestEntryFees ?? []).filter((f) => f.facilityId === facilityId) : [];

  return prisma.$transaction(
    async (tx) => {
      // ── Age bands ──
      const bandIdBySss = new Map<string, string>();
      for (const b of cat.ageBands) {
        const row = await tx.ageBand.upsert({
          where: { clubId_sssId: { clubId: club.id, sssId: b.id } },
          create: { clubId: club.id, sssId: b.id, label: b.name, minAge: b.minAgeYears, maxAge: b.maxAgeYears },
          update: { label: b.name, minAge: b.minAgeYears, maxAge: b.maxAgeYears, archived: false },
        });
        bandIdBySss.set(b.id, row.id);
      }
      const staleBands = await tx.ageBand.findMany({
        where: { clubId: club.id, OR: [{ sssId: null }, { sssId: { notIn: cat.ageBands.map((b) => b.id) } }] },
        include: { _count: { select: { memberships: true, passes: true } } },
      });
      for (const b of staleBands) {
        if (b._count.memberships || b._count.passes) {
          await tx.planPrice.deleteMany({ where: { ageBandId: b.id } });
          await tx.dayUseFee.deleteMany({ where: { ageBandId: b.id } });
          await tx.guestFee.deleteMany({ where: { ageBandId: b.id } });
          await tx.ageBand.update({ where: { id: b.id }, data: { archived: true } });
        } else {
          await tx.ageBand.delete({ where: { id: b.id } });
        }
      }

      // ── Plans (OUTSIDE column only) ──
      let onSale = 0;
      const seenPlans: string[] = [];
      for (const p of cat.plans) {
        const cells = p.outsidePrices
          .filter((c) => bandIdBySss.has(c.ageBandId))
          .map((c) => ({ ageBandId: bandIdBySss.get(c.ageBandId)!, price: Number(c.price) }))
          .filter((c) => Number.isFinite(c.price) && c.price >= 0);
        const sold = p.isActive && planCovers(p) && cells.length > 0;
        const facilityName = cat.facilities.find((f) => f.id === p.facilityId)?.name ?? null;
        const row = await tx.plan.upsert({
          where: { clubId_sssId: { clubId: club.id, sssId: p.id } },
          create: {
            clubId: club.id,
            sssId: p.id,
            name: p.name,
            description: p.description ?? (facilityName ? `Access to ${facilityName}` : null),
            termMonths: p.termMonths,
            guestsPerDay: p.outsiderGuestLimit ?? club.outsiderGuestsPerDay,
            isActive: sold,
          },
          update: {
            name: p.name,
            description: p.description ?? (facilityName ? `Access to ${facilityName}` : null),
            termMonths: p.termMonths,
            guestsPerDay: p.outsiderGuestLimit ?? club.outsiderGuestsPerDay,
            isActive: sold,
          },
        });
        seenPlans.push(row.id);
        await tx.planPrice.deleteMany({ where: { planId: row.id } });
        if (cells.length) await tx.planPrice.createMany({ data: cells.map((c) => ({ planId: row.id, ...c })) });
        if (sold) onSale++;
      }
      // Local plans (e.g. the seed) and plans deleted in SSS: archive if sold, else delete.
      const stalePlans = await tx.plan.findMany({
        where: { clubId: club.id, id: { notIn: seenPlans } },
        include: { _count: { select: { memberships: true } } },
      });
      for (const p of stalePlans) {
        if (p._count.memberships) await tx.plan.update({ where: { id: p.id }, data: { isActive: false } });
        else await tx.plan.delete({ where: { id: p.id } });
      }

      // ── Day-use fees ──
      await tx.dayUseFee.deleteMany({ where: { clubId: club.id } });
      const feeRows = fees
        .filter((f) => bandIdBySss.has(f.ageBandId) && Number.isFinite(Number(f.price)))
        .map((f) => ({ clubId: club.id, ageBandId: bandIdBySss.get(f.ageBandId)!, price: Number(f.price) }));
      if (feeRows.length) await tx.dayUseFee.createMany({ data: feeRows });

      // ── Member guest fees ──
      await tx.guestFee.deleteMany({ where: { clubId: club.id } });
      const guestRows = guestFees
        .filter((f) => bandIdBySss.has(f.ageBandId) && Number.isFinite(Number(f.price)))
        .map((f) => ({ clubId: club.id, ageBandId: bandIdBySss.get(f.ageBandId)!, price: Number(f.price) }));
      if (guestRows.length) await tx.guestFee.createMany({ data: guestRows });

      if (cat.currency && cat.currency !== club.currency) {
        await tx.club.update({ where: { id: club.id }, data: { currency: cat.currency } });
      }

      return {
        facilityId,
        ageBands: cat.ageBands.length,
        plansOnSale: onSale,
        plansHidden: cat.plans.length - onSale,
        dayUseFees: feeRows.length,
        guestFees: guestRows.length,
        syncedAt: new Date(),
      };
    },
    { timeout: 30000 },
  );
}

/** Background pull for every linked club (startup + every few minutes). */
export async function syncAllClubs() {
  if (!sssSyncConfigured()) return;
  const clubs = await prisma.club.findMany({ where: { sssCommunityId: { not: null }, isActive: true } });
  for (const c of clubs) {
    await syncClubCatalog(c.id).catch((err) => console.warn(`[sync] ${c.name}: ${err instanceof Error ? err.message : err}`));
  }
}
