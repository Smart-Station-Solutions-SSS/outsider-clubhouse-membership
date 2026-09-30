// The 14-digit Egyptian national ID carries its holder's birth date:
//
//   C YY MM DD GG SSSS K
//   │ └──┬───┘ │
//   │    │     └ governorate of birth (88 = born abroad)
//   │    └ birth date
//   └ century: 2 = 1900s, 3 = 2000s
//
// Ported from SSS-Community-App src/common/identity/egyptian-national-id.ts.
// There is no published check-digit algorithm, so the last 5 digits are not validated.

const NATIONAL_ID_PATTERN = /^\d{14}$/;

const GOVERNORATE_CODES = new Set([
  '01', '02', '03', '04',
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '34', '35',
  '88',
]);

const CENTURY: Record<string, number> = { '2': 1900, '3': 2000 };

/** ٠-٩ (Arabic-Indic) and ۰-۹ (Persian) → ASCII, then digits only. */
export function normalizeNationalId(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

/**
 * The birth date an Egyptian national ID encodes, as UTC midnight — or null when the
 * value is not structurally valid (length, century, governorate, impossible or future date).
 */
export function birthDateFromNationalId(nationalId: string | null | undefined, now: Date = new Date()): Date | null {
  const nid = normalizeNationalId(nationalId);
  if (!NATIONAL_ID_PATTERN.test(nid)) return null;

  const century = CENTURY[nid[0]];
  if (century === undefined) return null;
  if (!GOVERNORATE_CODES.has(nid.slice(7, 9))) return null;

  const year = century + Number(nid.slice(1, 3));
  const month = Number(nid.slice(3, 5));
  const day = Number(nid.slice(5, 7));
  const birth = new Date(Date.UTC(year, month - 1, day));
  const realDate =
    birth.getUTCFullYear() === year && birth.getUTCMonth() === month - 1 && birth.getUTCDate() === day;
  if (!realDate || birth.getTime() > now.getTime()) return null;
  return birth;
}

export function isValidNationalId(nationalId: string, now: Date = new Date()): boolean {
  return birthDateFromNationalId(nationalId, now) !== null;
}

/** Whole years between birth and `on` (both treated as calendar dates in UTC). */
export function ageOn(birth: Date, on: Date): number {
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < birth.getUTCMonth() ||
    (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
