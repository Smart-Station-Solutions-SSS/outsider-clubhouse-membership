export function money(amount: number | null | undefined, currency = 'EGP'): string {
  if (amount === null || amount === undefined) return '—';
  return `${amount.toLocaleString('en-EG', { maximumFractionDigits: 2 })} ${currency}`;
}

export function niceDate(day: string | null | undefined): string {
  if (!day) return '—';
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function term(months: number): string {
  if (months === 12) return '1 year';
  if (months % 12 === 0) return `${months / 12} years`;
  return months === 1 ? '1 month' : `${months} months`;
}

/** Today's date in Cairo, YYYY-MM-DD (matches the server's calendar). */
export function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Digits only (Arabic-Indic folded) — what the server expects for a national ID. */
export function cleanNationalId(v: string): string {
  return v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
    .slice(0, 14);
}

export const statusLabel: Record<string, string> = {
  PENDING_REVIEW: 'Waiting for approval',
  APPROVED: 'Approved — awaiting payment',
  PAID: 'Paid',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  PENDING_PAYMENT: 'Awaiting payment',
  ACTIVE: 'Active',
  USED: 'Used',
  EXPIRED: 'Expired',
};

/** Compact date for the membership card: "30 Sep 2026". */
export function cardDate(day: string | null | undefined): string {
  if (!day) return '—';
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysUntil(day: string, from: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * How a member's guests are priced: the guest fees set in the SSS dashboard when the club has
 * any, else the day-pass price minus the club's discount.
 */
export function guestPricing(club: { currency: string; guestDiscountPercent: number; guestFees: { price: number }[] }) {
  const prices = club.guestFees.map((f) => f.price);
  if (prices.length) {
    const from = money(Math.min(...prices), club.currency);
    return {
      perGuest: `from ${from} each`,
      stat: { value: String(Math.min(...prices)), label: `${club.currency} guest entry from` },
      amenity: `Members' guests enter from ${from}.`,
      sentence: `Guests pay the club's guest price, from ${from} depending on age`,
    };
  }
  const d = club.guestDiscountPercent;
  return {
    perGuest: `at ${d}% off`,
    stat: { value: `${d}%`, label: 'Guest discount' },
    amenity: `Members' guests save ${d}% on entry.`,
    sentence: `Guests pay the day-pass price minus ${d}%`,
  };
}
