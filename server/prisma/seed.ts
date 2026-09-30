import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Sample club so the site works out of the box. Real prices are set from the SSS
// dashboard through the admin API. Safe to re-run: does nothing if a club exists.

const prisma = new PrismaClient();

async function main() {
  if (await prisma.club.count()) {
    console.log('A club already exists — seed skipped.');
    return;
  }
  const club = await prisma.club.create({
    data: {
      name: 'The Clubhouse',
      sssCommunityId: process.env.SEED_SSS_COMMUNITY_ID || null,
      membershipApproval: 'ADMIN',
      dayUseApproval: 'ADMIN',
      guestDiscountPercent: 25,
    },
  });

  const bandDefs = [
    { label: 'Under 4', minAge: 0, maxAge: 3 },
    { label: 'Child 4–12', minAge: 4, maxAge: 12 },
    { label: 'Youth 13–20', minAge: 13, maxAge: 20 },
    { label: 'Adult 21–59', minAge: 21, maxAge: 59 },
    { label: 'Senior 60+', minAge: 60, maxAge: null },
  ];
  const bands = [];
  for (const b of bandDefs) bands.push(await prisma.ageBand.create({ data: { ...b, clubId: club.id } }));

  // price per band, in band order; null = not sold
  const plans: { name: string; termMonths: number; guestsPerDay: number; description: string; prices: (number | null)[] }[] = [
    { name: 'Monthly', termMonths: 1, guestsPerDay: 1, description: 'Full club access for one month.', prices: [null, 900, 1200, 1500, 1100] },
    { name: 'Quarterly', termMonths: 3, guestsPerDay: 2, description: 'Three months of club access.', prices: [null, 2400, 3200, 4000, 3000] },
    { name: 'Annual', termMonths: 12, guestsPerDay: 3, description: 'A full year — best value.', prices: [0, 8000, 10500, 13000, 9500] },
  ];
  for (const p of plans) {
    await prisma.plan.create({
      data: {
        clubId: club.id,
        name: p.name,
        termMonths: p.termMonths,
        guestsPerDay: p.guestsPerDay,
        description: p.description,
        prices: { create: p.prices.flatMap((price, i) => (price === null ? [] : [{ ageBandId: bands[i].id, price }])) },
      },
    });
  }
  const dayUse = [0, 150, 250, 350, 250];
  await prisma.dayUseFee.createMany({ data: dayUse.map((price, i) => ({ clubId: club.id, ageBandId: bands[i].id, price })) });
  console.log(`Seeded club "${club.name}" (${club.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
