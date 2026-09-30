// The national ID number — and with it the birth date and the price — is read off the card
// photo by OCR; nobody types it. An unreadable photo asks for a retake, but only
// MAX_ID_ATTEMPTS times: a blurry camera must not lock a real person out, so after the last
// failed try they may type the number themselves and the application goes to an admin
// flagged "ID not verified". (Ported from SSS outsider-portal.)

import { birthDateFromNationalId, normalizeNationalId } from './national-id';

export const MAX_ID_ATTEMPTS = 3;

export type OcrRead = { kind: 'ok'; nationalId: string } | { kind: 'unreadable' } | { kind: 'unavailable' };

/** MANUAL: no OCR ran because an admin reviews every application in that flow. */
export type IdAttemptOutcome = 'MATCHED' | 'MISMATCH' | 'UNREADABLE' | 'UNAVAILABLE' | 'MANUAL';

export type IdCheckDecision = {
  outcome: IdAttemptOutcome;
  /** The number read off the card, when it is a valid Egyptian national ID. */
  nationalId: string | null;
  attempts: number;
  attemptsLeft: number;
  /** Out of retries: the person may type the number (then flagged for review). */
  manualEntry: boolean;
};

export function decideIdCheck(input: { read: OcrRead; priorAttempts: number }): IdCheckDecision {
  const nationalId = input.read.kind === 'ok' ? normalizeNationalId(input.read.nationalId) : null;
  const readable = nationalId !== null && birthDateFromNationalId(nationalId) !== null;
  if (readable) {
    return {
      outcome: 'MATCHED',
      nationalId,
      attempts: input.priorAttempts,
      attemptsLeft: Math.max(0, MAX_ID_ATTEMPTS - input.priorAttempts),
      manualEntry: false,
    };
  }
  const attempts = Math.min(input.priorAttempts + 1, MAX_ID_ATTEMPTS);
  const attemptsLeft = Math.max(0, MAX_ID_ATTEMPTS - attempts);
  return {
    outcome: input.read.kind === 'unavailable' ? 'UNAVAILABLE' : 'UNREADABLE',
    nationalId: null,
    attempts,
    attemptsLeft,
    manualEntry: attemptsLeft === 0,
  };
}
