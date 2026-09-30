// Pure pricing rules. A missing price means "not sold" — never zero.

export type Band = { id: string; label: string; minAge: number; maxAge: number | null };

export function bandForAge<T extends Band>(bands: T[], age: number): T | null {
  return bands.find((b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge)) ?? null;
}

/**
 * Bands must start at 0, not overlap and leave no gap; only the last may be open-ended.
 * Returns a human-readable problem, or null when the set is valid.
 */
export function validateBands(bands: { minAge: number; maxAge: number | null }[]): string | null {
  if (bands.length === 0) return 'At least one age band is required';
  const sorted = [...bands].sort((a, b) => a.minAge - b.minAge);
  if (sorted[0].minAge !== 0) return 'The first age band must start at 0';
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.minAge < 0) return 'Ages cannot be negative';
    if (b.maxAge !== null && b.maxAge < b.minAge) return `Band ${b.minAge}-${b.maxAge} ends before it starts`;
    const next = sorted[i + 1];
    if (!next) break;
    if (b.maxAge === null) return 'Only the last age band can be open-ended';
    if (next.minAge !== b.maxAge + 1) return `Age bands must be continuous: ${b.maxAge} is followed by ${next.minAge}`;
  }
  if (sorted[sorted.length - 1].maxAge !== null) return 'The last age band must have no upper age';
  return null;
}

/** Money is handled in piastres to avoid float drift. */
export const toCents = (amount: number | string | { toString(): string }): number =>
  Math.round(Number(amount.toString()) * 100);
export const fromCents = (cents: number): number => cents / 100;

export function guestPriceCents(dayUseCents: number, discountPercent: number): number {
  const pct = Math.min(100, Math.max(0, discountPercent));
  return Math.round((dayUseCents * (100 - pct)) / 100);
}
