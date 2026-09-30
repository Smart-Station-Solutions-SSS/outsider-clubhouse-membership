import type { OcrStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { badRequest } from '../lib/errors';
import { MAX_ID_ATTEMPTS, decideIdCheck, type IdAttemptOutcome } from '../lib/id-check';
import { birthDateFromNationalId, normalizeNationalId } from '../lib/national-id';
import { ocr } from '../lib/ocr';
import { hashPii } from '../lib/pii';
import { formatDay } from '../lib/dates';
import { saveIdPhoto } from '../lib/uploads';

// One IdCheck row per verification session tracks the OCR attempts server-side; the client
// sends its checkId back on every retry. nationalIdHash stays empty until a number is known
// (read by OCR, or typed after the last failed try).

const CHECK_TTL_MS = 24 * 60 * 60 * 1000;

export type IdCheckResponse = {
  checkId: string;
  outcome: IdAttemptOutcome;
  attemptsLeft: number;
  canSubmit: boolean;
  /** Out of OCR tries: the person must type the number (flagged for staff review). */
  manualEntry: boolean;
  /** Read off the card (or typed, after the last failed try). */
  nationalId: string | null;
  /** Derived from the ID number; drives every price shown afterwards. */
  dateOfBirth: string | null;
};

export function requireNationalId(raw: unknown): { nationalId: string; dateOfBirth: Date; hash: string } {
  const nationalId = normalizeNationalId(raw);
  const dateOfBirth = birthDateFromNationalId(nationalId);
  if (!dateOfBirth) throw badRequest('invalid_national_id', 'Enter a valid 14-digit Egyptian national ID number');
  return { nationalId, dateOfBirth, hash: hashPii(nationalId) };
}

/**
 * When an admin approves every application anyway, no OCR runs: the person types the number
 * and uploads the photo, and the admin compares the two (the check counts as flagged).
 */
export async function runManualIdCheck(input: {
  image?: { buffer: Buffer; mimeType: string };
  typedNationalId?: string;
}): Promise<IdCheckResponse> {
  if (!input.typedNationalId) throw badRequest('national_id_required', 'Type the 14-digit number printed on your ID card');
  const { nationalId, dateOfBirth, hash } = requireNationalId(input.typedNationalId);
  if (!input.image) throw badRequest('photo_required', 'Upload a photo of the front of the national ID card');
  const check = await prisma.idCheck.create({
    data: {
      nationalIdHash: hash,
      attempts: MAX_ID_ATTEMPTS,
      imagePath: saveIdPhoto(input.image.buffer, input.image.mimeType),
      expiresAt: new Date(Date.now() + CHECK_TTL_MS),
    },
  });
  return {
    checkId: check.id,
    outcome: 'MANUAL',
    attemptsLeft: 0,
    canSubmit: true,
    manualEntry: true,
    nationalId,
    dateOfBirth: formatDay(dateOfBirth),
  };
}

export async function runIdCheck(input: {
  checkId?: string;
  image?: { buffer: Buffer; mimeType: string };
  /** Only accepted once the OCR tries are used up. */
  typedNationalId?: string;
}): Promise<IdCheckResponse> {
  let check = input.checkId
    ? await prisma.idCheck.findFirst({ where: { id: input.checkId, usedAt: null, expiresAt: { gt: new Date() } } })
    : null;
  if (!check) {
    check = await prisma.idCheck.create({ data: { nationalIdHash: '', expiresAt: new Date(Date.now() + CHECK_TTL_MS) } });
  }
  if (check.matched) throw badRequest('id_check_done', 'Your ID is already verified');

  if (check.attempts >= MAX_ID_ATTEMPTS) {
    // Out of tries: the typed number is used and the photo on file is left for an admin to judge.
    if (!input.typedNationalId) throw badRequest('national_id_required', 'Type the 14-digit number printed on your ID card');
    const { nationalId, dateOfBirth, hash } = requireNationalId(input.typedNationalId);
    await prisma.idCheck.update({ where: { id: check.id }, data: { nationalIdHash: hash } });
    return {
      checkId: check.id,
      outcome: 'MISMATCH',
      attemptsLeft: 0,
      canSubmit: true,
      manualEntry: true,
      nationalId,
      dateOfBirth: formatDay(dateOfBirth),
    };
  }

  if (!input.image) throw badRequest('photo_required', 'Upload a photo of the front of the national ID card');
  const read = await ocr.reader.read(input.image.buffer, input.image.mimeType);
  const decision = decideIdCheck({ read, priorAttempts: check.attempts });
  const imagePath = saveIdPhoto(input.image.buffer, input.image.mimeType);
  const matched = decision.outcome === 'MATCHED' && decision.nationalId !== null;
  await prisma.idCheck.update({
    where: { id: check.id },
    data: {
      attempts: decision.attempts,
      matched,
      imagePath,
      ocrName: read.kind === 'ok' ? (read.fullName ?? null) : null,
      ...(matched ? { nationalIdHash: hashPii(decision.nationalId!) } : {}),
    },
  });
  const dateOfBirth = matched ? birthDateFromNationalId(decision.nationalId) : null;
  return {
    checkId: check.id,
    outcome: decision.outcome,
    attemptsLeft: decision.attemptsLeft,
    canSubmit: matched,
    manualEntry: decision.manualEntry,
    nationalId: matched ? decision.nationalId : null,
    dateOfBirth: dateOfBirth ? formatDay(dateOfBirth) : null,
  };
}

/** Claims a finished check for a signup/day-use submission. Must run inside the caller's transaction. */
export async function consumeIdCheck(
  tx: Prisma.TransactionClient,
  checkId: string,
  nationalIdHash: string,
): Promise<{ ocrStatus: OcrStatus; imagePath: string | null }> {
  const check = await tx.idCheck.findUnique({ where: { id: checkId } });
  if (!check || check.nationalIdHash !== nationalIdHash || check.expiresAt < new Date()) {
    throw badRequest('id_check_required', 'Please upload a photo of your national ID card first');
  }
  if (!check.matched && check.attempts < MAX_ID_ATTEMPTS) {
    throw badRequest('id_check_incomplete', 'Your ID photo could not be read yet. Please retake the photo.');
  }
  const claimed = await tx.idCheck.updateMany({ where: { id: checkId, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw badRequest('id_check_used', 'This ID check was already used. Please upload the photo again.');
  return { ocrStatus: check.matched ? 'MATCHED' : 'MISMATCH_FLAGGED', imagePath: check.imagePath };
}
