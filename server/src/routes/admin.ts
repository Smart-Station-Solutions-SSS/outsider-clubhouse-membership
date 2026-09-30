import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { notFound } from '../lib/errors';
import { resolveUpload } from '../lib/uploads';
import { actorOf, requireApiKey } from '../middleware/auth';
import {
  adminCatalog,
  createClub,
  createPlan,
  deletePlan,
  listClubs,
  replaceAgeBands,
  replaceDayUseFees,
  updateClub,
  updatePlan,
} from '../services/admin';
import { adminMemberDto, decideMember } from '../services/members';
import { membershipDto } from '../services/memberships';
import { recordManualMembershipPayment } from '../services/payments';
import { checkIn, decideVisitRequest, visitRequestDto } from '../services/visits';
import { managedBySss, syncClubCatalog } from '../services/catalog-sync';
import { decision, priceCell } from './schemas';

// Called by the SSS backend (server to server) with an ADMIN x-api-key.
// Optional `x-actor` header: the SSS admin's name/id, recorded on approve/reject.

export const adminRouter = Router();
adminRouter.use('/admin', requireApiKey('ADMIN'));

const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const approval = z.enum(['AUTO', 'ADMIN']);
const settings = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  sssCommunityId: z.string().trim().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  membershipApproval: approval.optional(),
  dayUseApproval: approval.optional(),
  guestDiscountPercent: z.number().int().min(0).max(100).optional(),
  outsiderGuestsPerDay: z.number().int().min(0).max(20).optional(),
  sssFacilityId: z.string().trim().min(1).max(100).nullable().optional(),
});

type ClubRow = Awaited<ReturnType<typeof prisma.club.findUniqueOrThrow>>;

function settingsDto(c: ClubRow) {
  return {
    id: c.id,
    name: c.name,
    sssCommunityId: c.sssCommunityId,
    isActive: c.isActive,
    currency: c.currency,
    membershipApproval: c.membershipApproval,
    dayUseApproval: c.dayUseApproval,
    guestDiscountPercent: c.guestDiscountPercent,
    outsiderGuestsPerDay: c.outsiderGuestsPerDay,
    sssFacilityId: c.sssFacilityId,
    catalogManagedBySss: managedBySss(c),
    catalogSyncedAt: c.catalogSyncedAt,
    catalogSyncError: c.catalogSyncError,
  };
}

// ── Clubs & settings ──
adminRouter.get('/admin/clubs', async (_req, res) => {
  res.json({ clubs: (await listClubs()).map(settingsDto) });
});

adminRouter.post('/admin/clubs', async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(120), sssCommunityId: z.string().trim().min(1).max(100).nullable().optional(), currency: z.string().length(3).optional() }).parse(req.body);
  res.status(201).json({ club: settingsDto(await createClub(body)) });
});

adminRouter.get('/admin/clubs/:clubId', async (req, res) => {
  res.json(await adminCatalog(req.params.clubId));
});

adminRouter.get('/admin/clubs/:clubId/settings', async (req, res) => {
  const club = await prisma.club.findUnique({ where: { id: req.params.clubId } });
  if (!club) throw notFound('Club not found');
  res.json({ settings: settingsDto(club) });
});

adminRouter.patch('/admin/clubs/:clubId/settings', async (req, res) => {
  res.json({ settings: settingsDto(await updateClub(req.params.clubId, settings.parse(req.body))) });
});

adminRouter.get('/admin/clubs/:clubId/summary', async (req, res) => {
  const clubId = req.params.clubId;
  const [pendingMembers, pendingDayUse, pendingGuests, activeMemberships] = await Promise.all([
    prisma.member.count({ where: { clubId, status: 'PENDING_REVIEW' } }),
    prisma.visitRequest.count({ where: { clubId, kind: 'DAY_USE', status: 'PENDING_REVIEW' } }),
    prisma.visitRequest.count({ where: { clubId, kind: 'GUEST', status: 'PENDING_REVIEW' } }),
    prisma.membership.count({ where: { member: { clubId }, status: 'ACTIVE' } }),
  ]);
  res.json({ pendingMembers, pendingDayUse, pendingGuests, activeMemberships });
});

/** Pull plans, age bands and prices from SSS now (e.g. right after an admin edits them there). */
adminRouter.post('/admin/clubs/:clubId/sync-catalog', async (req, res) => {
  res.json({ sync: await syncClubCatalog(req.params.clubId) });
});

// ── Prices ──
adminRouter.put('/admin/clubs/:clubId/age-bands', async (req, res) => {
  const body = z
    .object({
      bands: z
        .array(z.object({ id: z.string().uuid().optional(), label: z.string().trim().min(1).max(60), minAge: z.number().int().min(0).max(130), maxAge: z.number().int().min(0).max(130).nullable() }))
        .min(1)
        .max(20),
    })
    .parse(req.body);
  res.json({ ageBands: await replaceAgeBands(req.params.clubId, body.bands) });
});

const planBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  termMonths: z.number().int().min(1).max(120),
  guestsPerDay: z.number().int().min(0).max(50),
  isActive: z.boolean().optional(),
  prices: z.array(priceCell).max(20),
});

adminRouter.post('/admin/clubs/:clubId/plans', async (req, res) => {
  res.status(201).json({ plan: await createPlan(req.params.clubId, planBody.parse(req.body)) });
});

adminRouter.patch('/admin/clubs/:clubId/plans/:planId', async (req, res) => {
  res.json({ plan: await updatePlan(req.params.clubId, req.params.planId, planBody.partial().parse(req.body)) });
});

adminRouter.delete('/admin/clubs/:clubId/plans/:planId', async (req, res) => {
  res.json(await deletePlan(req.params.clubId, req.params.planId));
});

adminRouter.put('/admin/clubs/:clubId/day-use-fees', async (req, res) => {
  const body = z.object({ fees: z.array(priceCell).max(20) }).parse(req.body);
  res.json({ dayUseFees: await replaceDayUseFees(req.params.clubId, body.fees) });
});

// ── Membership applications ──
adminRouter.get('/admin/clubs/:clubId/members', async (req, res) => {
  const q = page
    .extend({ status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']).optional(), search: z.string().trim().max(100).optional() })
    .parse(req.query);
  const where: Prisma.MemberWhereInput = {
    clubId: req.params.clubId,
    status: q.status,
    ...(q.search
      ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, members: rows.map(adminMemberDto) });
});

adminRouter.get('/admin/members/:id', async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: req.params.id }, include: { memberships: { include: { plan: true }, orderBy: { createdAt: 'desc' } } } });
  if (!m) throw notFound('Member not found');
  res.json({ member: adminMemberDto(m), memberships: m.memberships.map(membershipDto) });
});

adminRouter.get('/admin/members/:id/id-photo', async (req, res) => {
  const m = await prisma.member.findUnique({ where: { id: req.params.id } });
  if (!m) throw notFound('Member not found');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(resolveUpload(m.idImagePath));
});

adminRouter.post('/admin/members/:id/approve', async (req, res) => {
  const body = decision.parse(req.body ?? {});
  res.json({ member: adminMemberDto(await decideMember(req.params.id, 'APPROVE', body.note, actorOf(req))) });
});

adminRouter.post('/admin/members/:id/reject', async (req, res) => {
  const body = decision.parse(req.body ?? {});
  res.json({ member: adminMemberDto(await decideMember(req.params.id, 'REJECT', body.note, actorOf(req))) });
});

// ── Day use & guest requests ──
adminRouter.get('/admin/clubs/:clubId/visit-requests', async (req, res) => {
  const q = page
    .extend({
      status: z.enum(['PENDING_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED']).optional(),
      kind: z.enum(['DAY_USE', 'GUEST']).optional(),
      visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .parse(req.query);
  const where: Prisma.VisitRequestWhereInput = {
    clubId: req.params.clubId,
    status: q.status,
    kind: q.kind,
    visitDate: q.visitDate ? new Date(`${q.visitDate}T00:00:00.000Z`) : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.visitRequest.count({ where }),
    prisma.visitRequest.findMany({ where, include: { passes: true }, orderBy: [{ visitDate: 'asc' }, { createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, requests: rows.map((r) => visitRequestDto(r, true)) });
});

adminRouter.get('/admin/visit-requests/:id', async (req, res) => {
  const r = await prisma.visitRequest.findUnique({ where: { id: req.params.id }, include: { passes: true } });
  if (!r) throw notFound('Request not found');
  res.json({ request: visitRequestDto(r, true) });
});

adminRouter.get('/admin/visit-requests/:id/id-photo', async (req, res) => {
  const r = await prisma.visitRequest.findUnique({ where: { id: req.params.id } });
  if (!r) throw notFound('Request not found');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(resolveUpload(r.idImagePath));
});

/** One guest's ID photo (members' guests each upload their own). */
adminRouter.get('/admin/passes/:id/id-photo', async (req, res) => {
  const p = await prisma.pass.findUnique({ where: { id: req.params.id } });
  if (!p) throw notFound('Pass not found');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(resolveUpload(p.idImagePath));
});

adminRouter.post('/admin/visit-requests/:id/approve', async (req, res) => {
  const body = decision.parse(req.body ?? {});
  res.json({ request: visitRequestDto(await decideVisitRequest(req.params.id, 'APPROVE', body.note, actorOf(req)), true) });
});

adminRouter.post('/admin/visit-requests/:id/reject', async (req, res) => {
  const body = decision.parse(req.body ?? {});
  res.json({ request: visitRequestDto(await decideVisitRequest(req.params.id, 'REJECT', body.note, actorOf(req)), true) });
});

// ── Memberships, payments, check-in ──
adminRouter.get('/admin/clubs/:clubId/memberships', async (req, res) => {
  const q = page.extend({ status: z.enum(['PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional() }).parse(req.query);
  const where: Prisma.MembershipWhereInput = { member: { clubId: req.params.clubId }, status: q.status };
  const [total, rows] = await Promise.all([
    prisma.membership.count({ where }),
    prisma.membership.findMany({ where, include: { plan: true, member: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    memberships: rows.map((m) => ({ ...membershipDto(m), member: { id: m.member.id, fullName: m.member.fullName, email: m.member.email, phone: m.member.phone } })),
  });
});

/** The desk took the money; activates the card like a Paymob payment would. */
adminRouter.post('/admin/memberships/:id/mark-paid', async (req, res) => {
  const body = z
    .object({ clubId: z.string().uuid().optional(), reference: z.string().trim().min(1).max(100).optional(), note: z.string().trim().min(1).max(500).optional() })
    .parse(req.body ?? {});
  const m = await recordManualMembershipPayment(req.params.id, body, actorOf(req));
  res.json({ membership: { ...membershipDto(m), member: { id: m.member.id, fullName: m.member.fullName, email: m.member.email, phone: m.member.phone } } });
});

adminRouter.get('/admin/clubs/:clubId/payments', async (req, res) => {
  const q = page.extend({ status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELED']).optional() }).parse(req.query);
  const where: Prisma.PaymentWhereInput = { clubId: req.params.clubId, status: q.status };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    payments: rows.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      amount: p.amountCents / 100,
      currency: p.currency,
      membershipId: p.membershipId,
      visitRequestId: p.visitRequestId,
      providerOrderId: p.providerOrderId,
      providerTransactionId: p.providerTransactionId,
      failureReason: p.failureReason,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
  });
});

adminRouter.post('/admin/check-in', async (req, res) => {
  const body = z.object({ qrToken: z.string().trim().min(5).max(100), clubId: z.string().uuid().optional() }).parse(req.body);
  res.json({ pass: await checkIn(body.clubId ?? null, body.qrToken) });
});
