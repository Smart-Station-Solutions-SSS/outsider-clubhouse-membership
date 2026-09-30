import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { notFound } from '../lib/errors';
import { requireApiKey } from '../middleware/auth';
import { loadClubBySssCommunity, publicCatalog } from '../services/catalog';
import {
  cancelVisitRequest,
  createGuestRequest,
  parseVisitDate,
  payVisitRequest,
  pricePeople,
  visitRequestDto,
} from '../services/visits';
import { day, email, name, person, phone } from './schemas';

// Called by the SSS backend (PARTNER x-api-key) so resident clubhouse members in the
// community app can invite discounted guests. SSS vouches that the resident holds an
// active membership and passes their plan's daily guest limit.

export const partnerRouter = Router();
partnerRouter.use('/partner', requireApiKey('PARTNER'));

const host = z.object({
  residentId: z.string().trim().min(1).max(100),
  name,
  email: email.optional().nullable(),
  phone,
  guestLimitPerDay: z.number().int().min(0).max(50),
});

partnerRouter.get('/partner/communities/:communityId/guest-policy', async (req, res) => {
  const club = await loadClubBySssCommunity(req.params.communityId);
  const cat = publicCatalog(club);
  res.json({
    clubId: club.id,
    clubName: club.name,
    currency: club.currency,
    approval: club.dayUseApproval,
    guestDiscountPercent: club.guestDiscountPercent,
    ageBands: cat.ageBands,
    dayUseFees: cat.dayUseFees,
    /** Member guest prices from the SSS dashboard; empty = dayUseFees minus guestDiscountPercent. */
    guestFees: cat.guestFees,
  });
});

partnerRouter.post('/partner/communities/:communityId/guest-quote', async (req, res) => {
  const body = z.object({ visitDate: day, guests: z.array(person.pick({ fullName: true, nationalId: true })).min(1).max(10) }).parse(req.body);
  const club = await loadClubBySssCommunity(req.params.communityId);
  const priced = pricePeople(club, body.guests, parseVisitDate(body.visitDate), true);
  res.json({
    currency: club.currency,
    discountPercent: club.guestDiscountPercent,
    guests: priced.map((p) => ({ fullName: p.fullName, ageBandId: p.ageBandId, price: p.priceCents / 100 })),
    total: priced.reduce((s, p) => s + p.priceCents, 0) / 100,
  });
});

partnerRouter.post('/partner/communities/:communityId/guest-requests', async (req, res) => {
  const body = z.object({ host, visitDate: day, guests: z.array(person).min(1).max(10) }).parse(req.body);
  const club = await loadClubBySssCommunity(req.params.communityId);
  const r = await createGuestRequest(club, { kind: 'SSS_RESIDENT', ...body.host }, body);
  const full = await prisma.visitRequest.findUniqueOrThrow({ where: { id: r.id }, include: { passes: true } });
  res.status(201).json({ request: visitRequestDto(full) });
});

partnerRouter.get('/partner/communities/:communityId/residents/:residentId/guest-requests', async (req, res) => {
  const club = await loadClubBySssCommunity(req.params.communityId);
  const rows = await prisma.visitRequest.findMany({
    where: { clubId: club.id, hostSssResidentId: req.params.residentId, kind: 'GUEST' },
    include: { passes: true },
    orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json({ requests: rows.map((r) => visitRequestDto(r)) });
});

/** Every per-request call names the resident, so one resident can't act on another's invitation. */
async function residentRequest(id: string, residentId: unknown) {
  const rid = z.string().min(1).parse(residentId);
  const r = await prisma.visitRequest.findUnique({ where: { id }, include: { passes: true, club: true } });
  if (!r || r.hostKind !== 'SSS_RESIDENT' || r.hostSssResidentId !== rid) throw notFound('Request not found');
  return r;
}

partnerRouter.get('/partner/guest-requests/:id', async (req, res) => {
  const r = await residentRequest(req.params.id, req.query.residentId);
  res.json({ request: visitRequestDto(r) });
});

partnerRouter.post('/partner/guest-requests/:id/pay', async (req, res) => {
  const r = await residentRequest(req.params.id, req.query.residentId);
  res.json(await payVisitRequest(r, r.club));
});

partnerRouter.post('/partner/guest-requests/:id/cancel', async (req, res) => {
  const r = await residentRequest(req.params.id, req.query.residentId);
  await cancelVisitRequest(r.id);
  res.json({ ok: true });
});
