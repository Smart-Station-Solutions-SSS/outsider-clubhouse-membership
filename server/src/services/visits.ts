import type { Member, Pass, Prisma, VisitRequest } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addDays, formatDay, parseDay, todayCairo } from '../lib/dates';
import { sendMail, webLink } from '../lib/mailer';
import { decryptPii, encryptPii, maskNationalId, randomToken, safeEqual, sha256 } from '../lib/pii';
import { fromCents, toCents } from '../lib/pricing';
import { quoteVisit, type ClubWithCatalog } from './catalog';
import { consumeIdCheck, requireNationalId } from './id-checks';
import { membershipCovering } from './memberships';
import { openCheckout } from './payments';

// Day use: a non-member pays for one day. Guests: a member invites people at the day-use
// price minus the club's guest discount. Both are one VisitRequest with one Pass per person
// and follow the club's dayUseApproval mode.

export const MAX_DAYS_AHEAD = 60;
const LIVE_PASS: Prisma.EnumPassStatusFilter = { notIn: ['REJECTED', 'CANCELLED', 'EXPIRED'] };

/** idCheckId: a guest's uploaded ID photo (required for members' guests). */
export type PersonInput = { fullName: string; nationalId: string; phone?: string | null; idCheckId?: string };

type PricedPerson = {
  fullName: string;
  phone: string | null;
  nationalId: string;
  hash: string;
  dateOfBirth: Date;
  ageBandId: string;
  priceCents: number;
  idCheckId: string | null;
  idImagePath?: string | null;
};

export function parseVisitDate(raw: string): Date {
  let day: Date;
  try {
    day = parseDay(raw);
  } catch {
    throw badRequest('invalid_date', 'Choose a valid visit date');
  }
  const today = parseDay(todayCairo());
  if (day < today) throw badRequest('date_in_past', 'The visit date cannot be in the past');
  if (day > addDays(today, MAX_DAYS_AHEAD)) {
    throw badRequest('date_too_far', `You can book up to ${MAX_DAYS_AHEAD} days ahead`);
  }
  return day;
}

/** Validates and prices everyone on the request; throws with the first person that can't be sold. */
export function pricePeople(club: ClubWithCatalog, people: PersonInput[], visitDate: Date, asGuest: boolean): PricedPerson[] {
  if (people.length === 0) throw badRequest('no_people', 'Add at least one person');
  const seen = new Set<string>();
  return people.map((p, i) => {
    const who = p.fullName?.trim() || `Person ${i + 1}`;
    let parsed;
    try {
      parsed = requireNationalId(p.nationalId);
    } catch {
      throw badRequest('invalid_national_id', `${who}: enter a valid 14-digit national ID number`, { index: i });
    }
    if (seen.has(parsed.hash)) throw badRequest('duplicate_person', `${who} is listed twice`, { index: i });
    seen.add(parsed.hash);
    const q = quoteVisit(club, parsed.dateOfBirth, visitDate, asGuest);
    if (q.priceCents === null || !q.ageBandId) {
      throw badRequest('not_sold', `${who}: day entry is not sold for age ${q.age}`, { index: i });
    }
    return {
      fullName: p.fullName.trim(),
      phone: p.phone?.trim() || null,
      nationalId: parsed.nationalId,
      hash: parsed.hash,
      dateOfBirth: parsed.dateOfBirth,
      ageBandId: q.ageBandId,
      priceCents: q.priceCents,
      idCheckId: p.idCheckId ?? null,
    };
  });
}

async function assertNoDoubleBooking(tx: Prisma.TransactionClient, people: PricedPerson[], visitDate: Date) {
  const clash = await tx.pass.findFirst({
    where: { visitDate, nationalIdHash: { in: people.map((p) => p.hash) }, status: LIVE_PASS },
  });
  if (clash) throw conflict('already_booked', `${clash.fullName} already has a pass for this day`);
}

/** Where the payer sees this request: their Day pass or Guests page (older day passes: a private link). */
export function visitLink(r: Pick<VisitRequest, 'id' | 'kind' | 'accessTokenEnc' | 'hostMemberId'>): string {
  if (r.kind === 'GUEST') return webLink('/guests');
  if (r.hostMemberId) return webLink('/day-pass');
  return r.accessTokenEnc ? webLink(`/visit/${r.id}?t=${decryptPii(r.accessTokenEnc)}`) : webLink('/');
}

function passRows(people: PricedPerson[], kind: 'DAY_USE' | 'GUEST', visitDate: Date, approved: boolean) {
  return people.map((p) => ({
    kind,
    visitDate,
    fullName: p.fullName,
    phone: p.phone,
    nationalIdEnc: encryptPii(p.nationalId),
    nationalIdHash: p.hash,
    dateOfBirth: p.dateOfBirth,
    ageBandId: p.ageBandId,
    price: fromCents(p.priceCents),
    idImagePath: p.idImagePath ?? null,
    status: approved ? ('PENDING_PAYMENT' as const) : ('PENDING_REVIEW' as const),
  }));
}

// ── Day use ─────────────────────────────────────────────────────────────

/** An email-only account says who is booking, with a photo of their ID (see /id-check). */
export type DayUseBuyer = { fullName: string; phone: string; nationalId: string; idCheckId: string };

/** The person booking: the applicant on file, or (email-only account) the details sent with the booking. */
export function dayUseBuyer(member: Member, sent?: DayUseBuyer): PersonInput & { phone: string } {
  if (member.status !== 'ACCOUNT' && member.fullName && member.nationalIdEnc && member.phone) {
    return { fullName: member.fullName, nationalId: decryptPii(member.nationalIdEnc), phone: member.phone };
  }
  if (!sent) throw badRequest('buyer_required', 'Enter your name, mobile number and national ID, with a photo of your ID');
  return { fullName: sent.fullName, nationalId: sent.nationalId, phone: sent.phone, idCheckId: sent.idCheckId };
}

/**
 * A day pass booked from an account without an active membership (members with one invite guests).
 * The buyer is the account holder, with the ID verified at sign-up; companions are typed in.
 */
export async function createDayUse(
  club: ClubWithCatalog,
  memberId: string,
  input: { visitDate: string; companions: PersonInput[]; buyer?: DayUseBuyer },
): Promise<VisitRequest> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member || member.clubId !== club.id) throw notFound('Account not found');
  if (member.status === 'REJECTED') throw forbidden('account_rejected', 'Your account was not approved. Please contact the club.');
  const visitDate = parseVisitDate(input.visitDate);
  if (await membershipCovering(member.id, visitDate)) {
    throw conflict('member_use_guests', 'You have an active membership on this day. Invite your group from the Guests page instead.');
  }
  const buyer = dayUseBuyer(member, input.buyer);
  const people = pricePeople(club, [buyer, ...input.companions], visitDate, false);

  const request = await prisma.$transaction(async (tx) => {
    await assertNoDoubleBooking(tx, people, visitDate);
    // An email-only account proves the buyer's ID with a photo for this booking.
    const id = buyer.idCheckId
      ? await consumeIdCheck(tx, buyer.idCheckId, people[0].hash)
      : { ocrStatus: member.ocrStatus, imagePath: member.idImagePath };
    // Auto-approval only trusts an ID the OCR actually read (and an approved applicant's account).
    const approved = club.dayUseApproval === 'AUTO' && id.ocrStatus === 'MATCHED' && member.status !== 'PENDING_REVIEW';
    return tx.visitRequest.create({
      data: {
        clubId: club.id,
        kind: 'DAY_USE',
        status: approved ? 'APPROVED' : 'PENDING_REVIEW',
        visitDate,
        contactName: buyer.fullName,
        contactEmail: member.email,
        contactPhone: buyer.phone ?? '',
        hostMemberId: member.id,
        ocrStatus: id.ocrStatus,
        idImagePath: id.imagePath,
        total: fromCents(people.reduce((s, p) => s + p.priceCents, 0)),
        reviewedAt: approved ? new Date() : null,
        reviewedBy: approved ? 'auto' : null,
        passes: { create: passRows(people, 'DAY_USE', visitDate, approved) },
      },
    });
  });

  await sendMail(
    request.contactEmail,
    request.status === 'APPROVED' ? `${club.name} day pass — complete your payment` : `${club.name} day pass request received`,
    request.status === 'APPROVED'
      ? `Hi ${request.contactName},\n\nYour day pass for ${formatDay(visitDate)} is confirmed. Pay here to get your QR codes:\n${visitLink(request)}`
      : `Hi ${request.contactName},\n\nWe received your day pass request for ${formatDay(visitDate)}. We will email you once it is reviewed.\nTrack it here: ${visitLink(request)}`,
  );
  return request;
}

export async function findByAccessToken(requestId: string, token: string) {
  const r = await prisma.visitRequest.findUnique({ where: { id: requestId }, include: { passes: true, club: true } });
  if (!r || !r.accessTokenHash || !token || !safeEqual(r.accessTokenHash, sha256(token))) throw notFound('Request not found');
  return r;
}

// ── Guests ──────────────────────────────────────────────────────────────

export type GuestHost =
  | { kind: 'MEMBER'; memberId: string }
  | { kind: 'SSS_RESIDENT'; residentId: string; name: string; email?: string | null; phone: string; guestLimitPerDay: number };

export async function createGuestRequest(
  club: ClubWithCatalog,
  host: GuestHost,
  input: { visitDate: string; guests: PersonInput[] },
): Promise<VisitRequest> {
  const visitDate = parseVisitDate(input.visitDate);
  const people = pricePeople(club, input.guests, visitDate, true);

  let limit: number;
  let contact: { name: string; email: string | null; phone: string };
  let hostHash: string | null = null;
  if (host.kind === 'MEMBER') {
    const member = await prisma.member.findUnique({ where: { id: host.memberId } });
    if (!member || member.clubId !== club.id || member.status !== 'APPROVED') throw forbidden('not_member', 'Only members can invite guests');
    const card = await membershipCovering(member.id, visitDate);
    if (!card) throw forbidden('no_active_membership', 'You need an active membership on the visit day to invite guests');
    limit = card.plan.guestsPerDay;
    contact = { name: member.fullName ?? member.email, email: member.email, phone: member.phone ?? '' };
    hostHash = member.nationalIdHash;
  } else {
    limit = host.guestLimitPerDay;
    contact = { name: host.name, email: host.email ?? null, phone: host.phone };
  }
  if (hostHash && people.some((p) => p.hash === hostHash)) {
    throw badRequest('host_as_guest', 'You cannot invite yourself as a guest');
  }

  const request = await prisma.$transaction(
    async (tx) => {
      const hostWhere =
        host.kind === 'MEMBER' ? { hostMemberId: host.memberId } : { hostSssResidentId: host.residentId, clubId: club.id };
      const used = await tx.pass.count({
        where: { kind: 'GUEST', visitDate, status: LIVE_PASS, request: hostWhere },
      });
      if (used + people.length > limit) {
        throw badRequest(
          'guest_limit',
          limit === 0
            ? 'Your membership does not include guests'
            : `You can invite ${limit} guest(s) per day; ${Math.max(0, limit - used)} left for ${formatDay(visitDate)}`,
        );
      }
      await assertNoDoubleBooking(tx, people, visitDate);
      // Each of a member's guests comes with a photo of their ID, checked by the admin on approval.
      if (host.kind === 'MEMBER') {
        for (const [i, p] of people.entries()) {
          if (!p.idCheckId) throw badRequest('guest_photo_required', `${p.fullName}: add a photo of their ID`, { index: i });
          p.idImagePath = (await consumeIdCheck(tx, p.idCheckId, p.hash)).imagePath;
        }
      }
      // A member's guests always wait for an admin. SSS residents' guests follow the day-use toggle
      // (the host is a verified resident).
      const approved = host.kind === 'SSS_RESIDENT' && club.dayUseApproval === 'AUTO';
      return tx.visitRequest.create({
        data: {
          clubId: club.id,
          kind: 'GUEST',
          status: approved ? 'APPROVED' : 'PENDING_REVIEW',
          visitDate,
          contactName: contact.name,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          hostKind: host.kind,
          hostMemberId: host.kind === 'MEMBER' ? host.memberId : null,
          hostSssResidentId: host.kind === 'SSS_RESIDENT' ? host.residentId : null,
          hostSssName: host.kind === 'SSS_RESIDENT' ? host.name : null,
          total: fromCents(people.reduce((s, p) => s + p.priceCents, 0)),
          reviewedAt: approved ? new Date() : null,
          reviewedBy: approved ? 'auto' : null,
          passes: { create: passRows(people, 'GUEST', visitDate, approved) },
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );
  return request;
}

// ── Review, payment, check-in ───────────────────────────────────────────

export async function decideVisitRequest(requestId: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, by: string) {
  const r = await prisma.visitRequest.findUnique({ where: { id: requestId }, include: { club: true } });
  if (!r) throw notFound('Request not found');
  if (r.status !== 'PENDING_REVIEW') throw conflict('already_decided', `This request is already ${r.status.toLowerCase()}`);
  const approve = decision === 'APPROVE';
  await prisma.$transaction(async (tx) => {
    const moved = await tx.visitRequest.updateMany({
      where: { id: requestId, status: 'PENDING_REVIEW' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewNote: note?.trim() || null, reviewedAt: new Date(), reviewedBy: by },
    });
    if (moved.count !== 1) throw conflict('already_decided', 'This request was just decided by someone else');
    await tx.pass.updateMany({
      where: { requestId, status: 'PENDING_REVIEW' },
      data: { status: approve ? 'PENDING_PAYMENT' : 'REJECTED' },
    });
  });
  const what = r.kind === 'GUEST' ? 'guest invitation' : 'day pass request';
  await sendMail(
    r.contactEmail,
    `Your ${r.club.name} ${what} was ${approve ? 'approved' : 'declined'}`,
    approve
      ? `Hi ${r.contactName},\n\nYour ${what} for ${formatDay(r.visitDate)} is approved. ${
          r.kind === 'DAY_USE' ? `Pay and get your QR codes here: ${visitLink(r)}` : `Pay here: ${visitLink(r)}`
        }`
      : `Hi ${r.contactName},\n\nYour ${what} for ${formatDay(r.visitDate)} was not approved.${note ? `\n\nReason: ${note}` : ''}`,
  );
  return prisma.visitRequest.findUniqueOrThrow({ where: { id: requestId }, include: { passes: true } });
}

export async function payVisitRequest(request: VisitRequest, club: { id: string; currency: string }) {
  if (request.status !== 'APPROVED') {
    throw conflict('not_payable', request.status === 'PENDING_REVIEW' ? 'This request is waiting for approval' : 'This request can no longer be paid');
  }
  if (request.visitDate < parseDay(todayCairo())) throw conflict('visit_day_passed', 'The visit day has passed');
  return openCheckout({
    clubId: club.id,
    target: { visitRequestId: request.id },
    amountCents: toCents(request.total),
    currency: club.currency,
    payer: { name: request.contactName, email: request.contactEmail, phone: request.contactPhone },
  });
}

export async function cancelVisitRequest(requestId: string) {
  return prisma.$transaction(async (tx) => {
    const done = await tx.visitRequest.updateMany({
      where: { id: requestId, status: { in: ['PENDING_REVIEW', 'APPROVED'] } },
      data: { status: 'CANCELLED' },
    });
    if (done.count !== 1) throw conflict('not_cancellable', 'Only an unpaid request can be cancelled');
    await tx.pass.updateMany({ where: { requestId }, data: { status: 'CANCELLED' } });
  });
}

export async function checkIn(clubId: string | null, qrToken: string) {
  const pass = await prisma.pass.findUnique({ where: { qrToken }, include: { request: true } });
  if (!pass || (clubId && pass.request.clubId !== clubId)) throw notFound('Unknown pass');
  const today = todayCairo();
  if (pass.status === 'USED') throw conflict('already_used', `Pass already used at ${pass.usedAt?.toISOString()}`);
  if (pass.status !== 'ACTIVE') throw conflict('not_active', `Pass is ${pass.status.toLowerCase()}`);
  if (formatDay(pass.visitDate) !== today) throw conflict('wrong_day', `This pass is for ${formatDay(pass.visitDate)}`);
  const done = await prisma.pass.updateMany({ where: { id: pass.id, status: 'ACTIVE' }, data: { status: 'USED', usedAt: new Date() } });
  if (done.count !== 1) throw conflict('already_used', 'Pass already used');
  return passDto({ ...pass, status: 'USED', usedAt: new Date() }, true);
}

// ── DTOs ────────────────────────────────────────────────────────────────

export function passDto(p: Pass, full = false) {
  const nid = decryptPii(p.nationalIdEnc);
  return {
    id: p.id,
    kind: p.kind,
    visitDate: formatDay(p.visitDate),
    fullName: p.fullName,
    phone: p.phone,
    nationalIdMasked: maskNationalId(nid),
    ...(full ? { nationalId: nid } : {}),
    dateOfBirth: formatDay(p.dateOfBirth),
    ageBandId: p.ageBandId,
    price: Number(p.price),
    status: p.status,
    qrToken: p.status === 'ACTIVE' ? p.qrToken : null,
    hasIdPhoto: Boolean(p.idImagePath),
    usedAt: p.usedAt,
  };
}

export function visitRequestDto(r: VisitRequest & { passes: Pass[] }, full = false) {
  return {
    id: r.id,
    clubId: r.clubId,
    kind: r.kind,
    status: r.status,
    visitDate: formatDay(r.visitDate),
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    contactPhone: r.contactPhone,
    host:
      r.hostKind === 'MEMBER'
        ? { kind: 'MEMBER', memberId: r.hostMemberId }
        : r.hostKind === 'SSS_RESIDENT'
          ? { kind: 'SSS_RESIDENT', residentId: r.hostSssResidentId, name: r.hostSssName }
          : null,
    ocrStatus: r.ocrStatus,
    total: Number(r.total),
    reviewNote: r.status === 'REJECTED' || full ? r.reviewNote : null,
    ...(full ? { reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy, hasIdPhoto: Boolean(r.idImagePath) } : {}),
    createdAt: r.createdAt,
    passes: r.passes.map((p) => passDto(p, full)),
  };
}
