import bcrypt from 'bcryptjs';
import type { Member, OcrStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { formatDay } from '../lib/dates';
import { sendMail, webLink } from '../lib/mailer';
import { decryptPii, encryptPii, maskNationalId } from '../lib/pii';
import { consumeIdCheck, requireNationalId } from './id-checks';
import { loadActiveClub, type ClubWithCatalog } from './catalog';

/** An account that has applied for membership: its application fields are all set. */
export type Applicant = Member & {
  fullName: string;
  phone: string;
  nationalIdEnc: string;
  nationalIdHash: string;
  dateOfBirth: Date;
  ocrStatus: OcrStatus;
};

export function applicantOf(m: Member): Applicant {
  if (m.status === 'ACCOUNT' || !m.fullName || !m.phone || !m.nationalIdEnc || !m.nationalIdHash || !m.dateOfBirth || !m.ocrStatus) {
    throw forbidden('no_application', 'Apply for membership first');
  }
  return m as Applicant;
}

// Compared against when the email is unknown, so a missing account is not faster to reject.
const DUMMY_HASH = bcrypt.hashSync("no-such-account", 10);

export type ApplicationInput = { fullName: string; phone: string; nationalId: string; idCheckId: string };
export type SignupInput = ApplicationInput & { clubId: string; email: string; password: string };

const emailOf = (raw: string) => raw.trim().toLowerCase();

async function assertEmailFree(email: string) {
  if (await prisma.member.findUnique({ where: { email } })) {
    throw conflict('email_taken', 'An account with this email already exists. Please log in.');
  }
}

/** Email + password only: enough to book day passes; membership needs an application later. */
export async function register(input: { clubId: string; email: string; password: string }): Promise<Member> {
  const club = await loadActiveClub(input.clubId);
  const email = emailOf(input.email);
  await assertEmailFree(email);
  return prisma.member.create({
    data: { clubId: club.id, email, passwordHash: await bcrypt.hash(input.password, 10), status: 'ACCOUNT' },
  });
}

/** The application fields (and approval) for a membership application, claiming its ID check. */
async function applicationData(tx: Prisma.TransactionClient, club: ClubWithCatalog, input: ApplicationInput, hash: string, nationalId: string, dateOfBirth: Date) {
  const check = await consumeIdCheck(tx, input.idCheckId, hash);
  // Auto-approval only trusts an ID the OCR actually read; a flagged ID always gets a human look.
  const autoApprove = club.membershipApproval === 'AUTO' && check.ocrStatus === 'MATCHED';
  return {
    phone: input.phone.trim(),
    fullName: input.fullName.trim(),
    nationalIdEnc: encryptPii(nationalId),
    nationalIdHash: hash,
    dateOfBirth,
    idImagePath: check.imagePath,
    ocrStatus: check.ocrStatus,
    status: autoApprove ? ('APPROVED' as const) : ('PENDING_REVIEW' as const),
    reviewedAt: autoApprove ? new Date() : null,
    reviewedBy: autoApprove ? 'auto' : null,
  };
}

async function assertIdFree(clubId: string, hash: string, exceptMemberId?: string) {
  const owner = await prisma.member.findUnique({ where: { clubId_nationalIdHash: { clubId, nationalIdHash: hash } } });
  if (owner && owner.id !== exceptMemberId) throw conflict('national_id_taken', 'This national ID is already registered. Please log in.');
}

async function sendApplicationMail(member: Applicant, clubName: string) {
  await sendMail(
    member.email,
    member.status === 'APPROVED' ? `Welcome to ${clubName}` : `We received your ${clubName} application`,
    member.status === 'APPROVED'
      ? `Hi ${member.fullName},\n\nYour account is approved. Choose a membership plan and pay online:\n${webLink('/account')}`
      : `Hi ${member.fullName},\n\nThanks for applying. The club will review your application and email you once it is approved.`,
  );
}

/** New account and membership application in one go (the Become a member form, logged out). */
export async function signup(input: SignupInput): Promise<Member> {
  const club = await loadActiveClub(input.clubId);
  const { nationalId, dateOfBirth, hash } = requireNationalId(input.nationalId);
  const email = emailOf(input.email);
  await assertEmailFree(email);
  await assertIdFree(club.id, hash);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const member = await prisma.$transaction(async (tx) =>
    tx.member.create({ data: { clubId: club.id, email, passwordHash, ...(await applicationData(tx, club, input, hash, nationalId, dateOfBirth)) } }),
  );
  await sendApplicationMail(applicantOf(member), club.name);
  return member;
}

/** A logged-in email-only account applies for membership. */
export async function applyForMembership(memberId: string, input: ApplicationInput): Promise<Member> {
  const current = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (current.status !== 'ACCOUNT') throw conflict('already_applied', 'You have already applied for membership');
  const club = await loadActiveClub(current.clubId);
  const { nationalId, dateOfBirth, hash } = requireNationalId(input.nationalId);
  await assertIdFree(club.id, hash, memberId);
  const member = await prisma.$transaction(async (tx) =>
    tx.member.update({ where: { id: memberId }, data: await applicationData(tx, club, input, hash, nationalId, dateOfBirth) }),
  );
  await sendApplicationMail(applicantOf(member), club.name);
  return member;
}

export async function login(email: string, password: string): Promise<Member> {
  const member = await prisma.member.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await bcrypt.compare(password, member?.passwordHash ?? DUMMY_HASH);
  if (!member || !ok) throw unauthorized('Wrong email or password');
  return member;
}

export async function changePassword(memberId: string, current: string, next: string): Promise<Member> {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (!(await bcrypt.compare(current, member.passwordHash))) throw badRequest('wrong_password', 'Current password is wrong');
  return prisma.member.update({
    where: { id: memberId },
    data: { passwordHash: await bcrypt.hash(next, 10), sessionVersion: { increment: 1 } },
  });
}

export async function decideMember(memberId: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, by: string) {
  const member = await prisma.member.findUnique({ where: { id: memberId }, include: { club: true } });
  if (!member) throw notFound('Applicant not found');
  const target = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (member.status === target) return member;
  if (decision === 'REJECT' && member.status === 'APPROVED') {
    throw conflict('already_approved', 'This applicant is already approved');
  }
  const updated = await prisma.member.update({
    where: { id: memberId },
    data: { status: target, reviewNote: note?.trim() || null, reviewedAt: new Date(), reviewedBy: by },
  });
  await sendMail(
    member.email,
    decision === 'APPROVE' ? `Your ${member.club.name} application is approved` : `Your ${member.club.name} application`,
    decision === 'APPROVE'
      ? `Hi ${member.fullName},\n\nGood news — your application is approved. Log in to choose a plan and pay:\n${webLink('/account')}`
      : `Hi ${member.fullName},\n\nUnfortunately your application was not approved.${note ? `\n\nReason: ${note}` : ''}`,
  );
  return updated;
}

export function memberDto(m: Member) {
  return {
    id: m.id,
    clubId: m.clubId,
    fullName: m.fullName,
    email: m.email,
    phone: m.phone,
    nationalIdMasked: m.nationalIdEnc ? maskNationalId(decryptPii(m.nationalIdEnc)) : null,
    dateOfBirth: m.dateOfBirth ? formatDay(m.dateOfBirth) : null,
    ocrStatus: m.ocrStatus,
    status: m.status,
    reviewNote: m.status === 'REJECTED' ? m.reviewNote : null,
    createdAt: m.createdAt,
  };
}

/** Admin view: the full ID number is shown so staff can compare it with the photo. */
export function adminMemberDto(m: Member) {
  return {
    ...memberDto(m),
    nationalId: m.nationalIdEnc ? decryptPii(m.nationalIdEnc) : null,
    reviewNote: m.reviewNote,
    reviewedAt: m.reviewedAt,
    reviewedBy: m.reviewedBy,
    hasIdPhoto: Boolean(m.idImagePath),
  };
}
