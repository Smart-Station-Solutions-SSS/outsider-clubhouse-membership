import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { decryptPii } from '../lib/pii';
import { clearSession, requireMember, setSession } from '../middleware/auth';
import { guestFeeList, loadActiveClub, loadClub } from '../services/catalog';
import { applyForMembership, changePassword, login, memberDto, register, signup } from '../services/members';
import {
  cancelMembershipOrder,
  membershipDto,
  myPlanQuotes,
  orderMembership,
  payMembership,
} from '../services/memberships';
import {
  cancelVisitRequest,
  createDayUse,
  createGuestRequest,
  parseVisitDate,
  payVisitRequest,
  pricePeople,
  visitRequestDto,
} from '../services/visits';
import { day, email, name, nationalId, person, phone } from './schemas';

export const accountRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const password = z.string().min(8, 'Use at least 8 characters').max(100);

accountRouter.post('/auth/signup', authLimiter, async (req, res) => {
  const body = z
    .object({ clubId: z.string().uuid(), fullName: name, email, phone, password, nationalId, idCheckId: z.string().uuid() })
    .parse(req.body);
  const member = await signup(body);
  setSession(res, member);
  res.status(201).json({ member: memberDto(member) });
});

/** Email + password only (day passes). Membership is applied for later from the account. */
accountRouter.post('/auth/register', authLimiter, async (req, res) => {
  const body = z.object({ clubId: z.string().uuid(), email, password }).parse(req.body);
  const member = await register(body);
  setSession(res, member);
  res.status(201).json({ member: memberDto(member) });
});

accountRouter.post('/auth/login', authLimiter, async (req, res) => {
  const body = z.object({ email, password: z.string().min(1) }).parse(req.body);
  const member = await login(body.email, body.password);
  setSession(res, member);
  res.json({ member: memberDto(member) });
});

accountRouter.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// ── Everything below needs a logged-in member ──
accountRouter.use('/me', requireMember);

accountRouter.get('/me', async (req, res) => {
  const club = await loadClub(req.member!.clubId);
  res.json({
    member: memberDto(req.member!),
    club: {
      id: club.id,
      name: club.name,
      currency: club.currency,
      guestDiscountPercent: club.guestDiscountPercent,
      /** Set in the SSS dashboard; empty = guests pay the day-use fee minus guestDiscountPercent. */
      guestFees: guestFeeList(club),
    },
  });
});

/** An email-only account applies for membership (same details and ID check as the sign-up form). */
accountRouter.post('/me/apply', async (req, res) => {
  const body = z.object({ fullName: name, phone, nationalId, idCheckId: z.string().uuid() }).parse(req.body);
  const member = await applyForMembership(req.member!.id, body);
  res.json({ member: memberDto(member) });
});

accountRouter.post('/me/password', async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1), newPassword: password }).parse(req.body);
  const member = await changePassword(req.member!.id, body.currentPassword, body.newPassword);
  setSession(res, member);
  res.json({ ok: true });
});

accountRouter.get('/me/plans', async (req, res) => {
  res.json(await myPlanQuotes(req.member!.id));
});

accountRouter.get('/me/memberships', async (req, res) => {
  const rows = await prisma.membership.findMany({
    where: { memberId: req.member!.id, status: { not: 'CANCELLED' } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ memberships: rows.map(membershipDto) });
});

accountRouter.post('/me/memberships', async (req, res) => {
  const body = z.object({ planId: z.string().uuid() }).parse(req.body);
  const m = await orderMembership(req.member!.id, body.planId);
  res.status(201).json({ membership: membershipDto(await prisma.membership.findUniqueOrThrow({ where: { id: m.id }, include: { plan: true } })) });
});

accountRouter.post('/me/memberships/:id/pay', async (req, res) => {
  res.json(await payMembership(req.member!.id, req.params.id));
});

accountRouter.post('/me/memberships/:id/cancel', async (req, res) => {
  await cancelMembershipOrder(req.member!.id, req.params.id);
  res.json({ ok: true });
});

// ── Guests ──
accountRouter.post('/me/guest-quote', async (req, res) => {
  const body = z.object({ visitDate: day, guests: z.array(person.pick({ fullName: true, nationalId: true })).min(1).max(10) }).parse(req.body);
  const club = await loadActiveClub(req.member!.clubId);
  const visitDate = parseVisitDate(body.visitDate);
  const priced = pricePeople(club, body.guests, visitDate, true);
  res.json({
    currency: club.currency,
    discountPercent: club.guestDiscountPercent,
    guests: priced.map((p) => ({ fullName: p.fullName, ageBandId: p.ageBandId, price: p.priceCents / 100 })),
    total: priced.reduce((s, p) => s + p.priceCents, 0) / 100,
  });
});

accountRouter.get('/me/guest-requests', async (req, res) => {
  const rows = await prisma.visitRequest.findMany({
    where: { hostMemberId: req.member!.id, kind: 'GUEST' },
    include: { passes: true },
    orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json({ requests: rows.map((r) => visitRequestDto(r)) });
});

accountRouter.post('/me/guest-requests', async (req, res) => {
  const body = z.object({ visitDate: day, guests: z.array(person.extend({ idCheckId: z.string().uuid() })).min(1).max(10) }).parse(req.body);
  const club = await loadActiveClub(req.member!.clubId);
  const r = await createGuestRequest(club, { kind: 'MEMBER', memberId: req.member!.id }, body);
  const full = await prisma.visitRequest.findUniqueOrThrow({ where: { id: r.id }, include: { passes: true } });
  res.status(201).json({ request: visitRequestDto(full) });
});

// ── Day passes (accounts without an active membership) ──
const nameAndId = person.pick({ fullName: true, nationalId: true });
/** An email-only account says who is booking (with the check from uploading their ID photo). */
const dayUseBuyerSchema = z.object({ fullName: name, phone, nationalId, idCheckId: z.string().uuid() });

accountRouter.post('/me/day-use/quote', async (req, res) => {
  const body = z.object({ visitDate: day, companions: z.array(nameAndId).max(9), buyer: nameAndId.optional() }).parse(req.body);
  const club = await loadActiveClub(req.member!.clubId);
  const m = req.member!;
  const buyer = m.status !== 'ACCOUNT' && m.fullName && m.nationalIdEnc ? { fullName: m.fullName, nationalId: decryptPii(m.nationalIdEnc) } : body.buyer;
  if (!buyer) throw badRequest('buyer_required', 'Enter your name and national ID to see the price');
  const priced = pricePeople(club, [buyer, ...body.companions], parseVisitDate(body.visitDate), false);
  res.json({
    currency: club.currency,
    people: priced.map((p) => ({ fullName: p.fullName, ageBandId: p.ageBandId, price: p.priceCents / 100 })),
    total: priced.reduce((s, p) => s + p.priceCents, 0) / 100,
  });
});

accountRouter.get('/me/day-use', async (req, res) => {
  const rows = await prisma.visitRequest.findMany({
    where: { hostMemberId: req.member!.id, kind: 'DAY_USE' },
    include: { passes: true },
    orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  res.json({ requests: rows.map((r) => visitRequestDto(r)) });
});

accountRouter.post('/me/day-use', async (req, res) => {
  const body = z.object({ visitDate: day, companions: z.array(person).max(9), buyer: dayUseBuyerSchema.optional() }).parse(req.body);
  const club = await loadActiveClub(req.member!.clubId);
  const r = await createDayUse(club, req.member!.id, body);
  const full = await prisma.visitRequest.findUniqueOrThrow({ where: { id: r.id }, include: { passes: true } });
  res.status(201).json({ request: visitRequestDto(full) });
});

accountRouter.post('/me/day-use/:id/pay', async (req, res) => {
  const r = await myRequest(req.member!.id, req.params.id);
  res.json(await payVisitRequest(r, r.club));
});

accountRouter.post('/me/day-use/:id/cancel', async (req, res) => {
  const r = await myRequest(req.member!.id, req.params.id);
  await cancelVisitRequest(r.id);
  res.json({ ok: true });
});

/** A day pass or guest invitation this account made. */
async function myRequest(memberId: string, id: string) {
  const r = await prisma.visitRequest.findUnique({ where: { id }, include: { club: true } });
  if (!r || r.hostMemberId !== memberId) throw notFound('Request not found');
  return r;
}

accountRouter.post('/me/guest-requests/:id/pay', async (req, res) => {
  const r = await myRequest(req.member!.id, req.params.id);
  res.json(await payVisitRequest(r, r.club));
});

accountRouter.post('/me/guest-requests/:id/cancel', async (req, res) => {
  const r = await myRequest(req.member!.id, req.params.id);
  await cancelVisitRequest(r.id);
  res.json({ ok: true });
});
