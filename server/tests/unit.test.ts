import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { decideIdCheck } from '../src/lib/id-check';
import { ageOn, birthDateFromNationalId, normalizeNationalId } from '../src/lib/national-id';
import { inferOutcome, verifyHmac } from '../src/lib/paymob';
import { addMonths } from '../src/lib/dates';
import { bandForAge, guestPriceCents, validateBands } from '../src/lib/pricing';

describe('national ID', () => {
  it('reads the birth date for both centuries', () => {
    expect(birthDateFromNationalId('29001010112345')?.toISOString().slice(0, 10)).toBe('1990-01-01');
    expect(birthDateFromNationalId('31605050123456')?.toISOString().slice(0, 10)).toBe('2016-05-05');
  });

  it('folds Arabic-Indic digits', () => {
    expect(normalizeNationalId('٢٩٠٠١٠١٠١١٢٣٤٥')).toBe('29001010112345');
  });

  it('rejects bad century, governorate, impossible and future dates, wrong length', () => {
    expect(birthDateFromNationalId('19001010112345')).toBeNull(); // century 1
    expect(birthDateFromNationalId('29001015012345')).toBeNull(); // governorate 50
    expect(birthDateFromNationalId('29002300112345')).toBeNull(); // Feb 30
    expect(birthDateFromNationalId('39901010112345', new Date('2026-01-01'))).toBeNull(); // 2099
    expect(birthDateFromNationalId('2900101011234')).toBeNull();
  });

  it('computes age with the birthday boundary', () => {
    const birth = new Date('1990-06-15T00:00:00Z');
    expect(ageOn(birth, new Date('2026-06-14T00:00:00Z'))).toBe(35);
    expect(ageOn(birth, new Date('2026-06-15T00:00:00Z'))).toBe(36);
  });
});

describe('pricing', () => {
  const bands = [
    { id: 'a', label: '0-12', minAge: 0, maxAge: 12 },
    { id: 'b', label: '13+', minAge: 13, maxAge: null },
  ];
  it('finds the band for an age', () => {
    expect(bandForAge(bands, 12)?.id).toBe('a');
    expect(bandForAge(bands, 13)?.id).toBe('b');
    expect(bandForAge(bands, 99)?.id).toBe('b');
  });
  it('validates band tiling', () => {
    expect(validateBands(bands)).toBeNull();
    expect(validateBands([{ minAge: 1, maxAge: null }])).toMatch(/start at 0/);
    expect(validateBands([{ minAge: 0, maxAge: 10 }, { minAge: 12, maxAge: null }])).toMatch(/continuous/);
    expect(validateBands([{ minAge: 0, maxAge: 10 }, { minAge: 11, maxAge: 20 }])).toMatch(/no upper age/);
    expect(validateBands([{ minAge: 0, maxAge: null }, { minAge: 5, maxAge: null }])).toMatch(/open-ended/);
  });
  it('applies the guest discount', () => {
    expect(guestPriceCents(35000, 25)).toBe(26250);
    expect(guestPriceCents(35000, 0)).toBe(35000);
    expect(guestPriceCents(35000, 150)).toBe(0);
  });
  it('clamps month ends', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});

describe('ID photo check', () => {
  it('reads a valid number, then allows typing it after 3 failed tries', () => {
    expect(decideIdCheck({ read: { kind: 'ok', nationalId: '٢٩٠٠١٠١٠١١٢٣٤٥' }, priorAttempts: 0 }))
      .toMatchObject({ outcome: 'MATCHED', nationalId: '29001010112345', manualEntry: false });
    expect(decideIdCheck({ read: { kind: 'ok', nationalId: '19001010112345' }, priorAttempts: 0 }))
      .toMatchObject({ outcome: 'UNREADABLE', nationalId: null, attemptsLeft: 2, manualEntry: false });
    expect(decideIdCheck({ read: { kind: 'unreadable' }, priorAttempts: 2 }))
      .toMatchObject({ outcome: 'UNREADABLE', attemptsLeft: 0, manualEntry: true });
  });
});

describe('Paymob', () => {
  const tx = {
    amount_cents: 35000, created_at: '2026-09-30T10:00:00', currency: 'EGP', error_occured: false,
    has_parent_transaction: false, id: 123, integration_id: 456, is_3d_secure: true, is_auth: false,
    is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
    order: { id: 789 }, owner: 1, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true,
  };
  const sign = (secret: string) =>
    crypto.createHmac('sha512', secret)
      .update('35000' + '2026-09-30T10:00:00' + 'EGP' + 'false' + 'false' + '123' + '456' + 'true' + 'false' + 'false' + 'false' + 'true' + 'false' + '789' + '1' + 'false' + '2346' + 'MasterCard' + 'card' + 'true')
      .digest('hex');

  it('verifies the transaction HMAC', () => {
    expect(verifyHmac(tx, sign('s3cret'), 's3cret')).toBe(true);
    expect(verifyHmac(tx, sign('other'), 's3cret')).toBe(false);
    expect(verifyHmac({ ...tx, amount_cents: 100 }, sign('s3cret'), 's3cret')).toBe(false);
  });

  it('maps outcomes', () => {
    expect(inferOutcome(tx).status).toBe('COMPLETED');
    expect(inferOutcome({ ...tx, success: false }).status).toBe('FAILED');
    expect(inferOutcome({ ...tx, pending: true }).status).toBe('PENDING');
    expect(inferOutcome({ ...tx, is_voided: true }).status).toBe('CANCELED');
  });
});
