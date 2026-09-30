import crypto from 'crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/db';
import { sss, type SssCatalog } from '../src/lib/sss';

// Plans, age bands and prices come from SSS for a linked club.

const app = buildApp();
config.SSS_API_URL = 'http://sss.test';
config.SSS_SYNC_KEY = 'test-sync-key';

const FAC = 'fac-clubhouse';
const OTHER_FAC = 'fac-pool';
let catalog: SssCatalog;
let calls = 0;
sss.fetchCatalog = async () => {
  calls++;
  return structuredClone(catalog);
};

let clubId: string;
let adminKey: string;
const admin = () => ({ 'x-api-key': adminKey });

function baseCatalog(): SssCatalog {
  return {
    communityId: 'sss-comm',
    currency: 'EGP',
    ageBands: [
      { id: 'b-child', name: 'Child', minAgeYears: 0, maxAgeYears: 21 },
      { id: 'b-adult', name: 'Adult', minAgeYears: 22, maxAgeYears: 59 },
      { id: 'b-senior', name: 'Senior', minAgeYears: 60, maxAgeYears: null },
    ],
    facilities: [
      { id: FAC, name: 'ClubHouse' },
      { id: OTHER_FAC, name: 'Main Pool' },
    ],
    plans: [
      { id: 'p-annual', name: 'Clubhouse Annual', description: null, termMonths: 12, facilityId: FAC, isActive: true, outsidePrices: [{ ageBandId: 'b-adult', price: '20000.00' }, { ageBandId: 'b-child', price: 12000 }] },
      { id: 'p-all', name: 'All Facilities Quarterly', description: 'Everything', termMonths: 3, facilityId: null, isActive: true, outsidePrices: [{ ageBandId: 'b-adult', price: 7000 }] },
      { id: 'p-residents', name: 'Residents Only', description: null, termMonths: 12, facilityId: FAC, isActive: true, outsidePrices: [] },
      { id: 'p-pool', name: 'Pool Annual', description: null, termMonths: 12, facilityId: OTHER_FAC, isActive: true, outsidePrices: [{ ageBandId: 'b-adult', price: 5000 }] },
    ],
    outsiderEntryFees: [
      { facilityId: FAC, ageBandId: 'b-adult', price: 400 },
      { facilityId: FAC, ageBandId: 'b-child', price: 200 },
    ],
  };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "WebhookLedger","Payment","Pass","VisitRequest","Membership","Member","IdCheck","DayUseFee","PlanPrice","Plan","AgeBand","Club","ApiKey" CASCADE',
  );
  catalog = baseCatalog();
  calls = 0;
  const club = await prisma.club.create({ data: { name: 'Club', guestDiscountPercent: 10, outsiderGuestsPerDay: 2 } });
  clubId = club.id;
  // A local sample plan + band, as the seed leaves them.
  const band = await prisma.ageBand.create({ data: { clubId, label: 'Everyone', minAge: 0, maxAge: null } });
  await prisma.plan.create({ data: { clubId, name: 'Sample', termMonths: 1, prices: { create: [{ ageBandId: band.id, price: 100 }] } } });
  const prefix = crypto.randomBytes(4).toString('hex');
  adminKey = `ocm_${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
  await prisma.apiKey.create({ data: { name: 'SSS', kind: 'ADMIN', prefix, hash: crypto.createHash('sha256').update(adminKey).digest('hex') } });
});

const link = () => request(app).patch(`/api/admin/clubs/${clubId}/settings`).set(admin()).send({ sssCommunityId: 'sss-comm' });

describe('catalog sync from SSS', () => {
  it('linking pulls OUTSIDE-priced plans, bands and outsider day fees for the club facility', async () => {
    const res = await link();
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ catalogManagedBySss: true, catalogSyncError: null });
    expect(res.body.settings.catalogSyncedAt).toBeTruthy();
    expect(calls).toBe(1);

    const cat = (await request(app).get(`/api/clubs/${clubId}/catalog`)).body;
    expect(cat.ageBands.map((b: { label: string }) => b.label)).toEqual(['Child', 'Adult', 'Senior']);
    // Residents-only (no OUTSIDE price) and the other facility's plan are hidden; the sample plan is gone.
    expect(cat.plans.map((p: { name: string }) => p.name).sort()).toEqual(['All Facilities Quarterly', 'Clubhouse Annual']);
    const annual = cat.plans.find((p: { name: string }) => p.name === 'Clubhouse Annual');
    expect(annual.prices).toHaveLength(2);
    expect(annual.guestsPerDay).toBe(2);
    expect(annual.description).toBe('Access to ClubHouse');
    expect(cat.dayUseFees).toHaveLength(2);
  });

  it('re-sync applies price edits and removals; local price edits are refused', async () => {
    await link();
    catalog.plans[0].outsidePrices = [{ ageBandId: 'b-adult', price: 21000 }];
    catalog.plans.splice(1, 1); // "All Facilities" deleted in SSS
    catalog.outsiderEntryFees = [{ facilityId: FAC, ageBandId: 'b-adult', price: 450 }];
    const sync = await request(app).post(`/api/admin/clubs/${clubId}/sync-catalog`).set(admin());
    expect(sync.body.sync).toMatchObject({ facilityId: FAC, plansOnSale: 1, dayUseFees: 1 });

    const cat = (await request(app).get(`/api/clubs/${clubId}/catalog`)).body;
    expect(cat.plans).toHaveLength(1);
    expect(cat.plans[0].prices).toEqual([{ ageBandId: expect.any(String), price: 21000 }]);
    expect(cat.dayUseFees[0].price).toBe(450);

    const edit = await request(app).put(`/api/admin/clubs/${clubId}/day-use-fees`).set(admin()).send({ fees: [] });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('catalog_managed_by_sss');
  });

  it('keeps the last catalog and records the error when SSS fails', async () => {
    await link();
    sss.fetchCatalog = async () => {
      throw new Error('SSS answered 500 when loading plans and prices');
    };
    const res = await request(app).post(`/api/admin/clubs/${clubId}/sync-catalog`).set(admin());
    expect(res.status).toBe(500);
    const settings = (await request(app).get(`/api/admin/clubs/${clubId}/settings`).set(admin())).body.settings;
    expect(settings.catalogSyncError).toContain('500');
    expect((await request(app).get(`/api/clubs/${clubId}/catalog`)).body.plans).toHaveLength(2);
    sss.fetchCatalog = async () => structuredClone(catalog);
  });

  it('prices member guests from the SSS GUEST fees, else from the discount', async () => {
    await link();
    let cat = (await request(app).get(`/api/clubs/${clubId}/catalog`)).body;
    expect(cat.guestFees).toEqual([]); // older SSS without guestEntryFees: discount applies

    catalog.guestEntryFees = [
      { facilityId: FAC, ageBandId: 'b-adult', price: '150.00' },
      { facilityId: OTHER_FAC, ageBandId: 'b-child', price: 99 },
    ];
    const sync = await request(app).post(`/api/admin/clubs/${clubId}/sync-catalog`).set(admin());
    expect(sync.body.sync).toMatchObject({ guestFees: 1 });
    cat = (await request(app).get(`/api/clubs/${clubId}/catalog`)).body;
    expect(cat.guestFees).toEqual([{ ageBandId: expect.any(String), price: 150 }]);
  });

  it('outsiderGuestsPerDay updates synced plans', async () => {
    await link();
    await request(app).patch(`/api/admin/clubs/${clubId}/settings`).set(admin()).send({ outsiderGuestsPerDay: 4 });
    const cat = (await request(app).get(`/api/clubs/${clubId}/catalog`)).body;
    expect(cat.plans.every((p: { guestsPerDay: number }) => p.guestsPerDay === 4)).toBe(true);
  });

  it("a plan's outsiderGuestLimit from SSS overrides the club default", async () => {
    catalog.plans[0].outsiderGuestLimit = 3;
    await link();
    const cat = (await request(app).get(`/api/clubs/${clubId}/catalog`)).body;
    const byName = Object.fromEntries(cat.plans.map((p: { name: string; guestsPerDay: number }) => [p.name, p.guestsPerDay]));
    expect(byName).toEqual({ 'Clubhouse Annual': 3, 'All Facilities Quarterly': 2 });
  });
});
