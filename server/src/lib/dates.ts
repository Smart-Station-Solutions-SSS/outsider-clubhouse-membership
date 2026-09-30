// All calendar dates (visit day, membership start/end) are Cairo calendar days,
// stored as UTC-midnight DATE columns.

const CAIRO = 'Africa/Cairo';

/** Today's date in Cairo as YYYY-MM-DD. */
export function todayCairo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function parseDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Bad date: ${day}`);
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || formatDay(d) !== day) throw new Error(`Bad date: ${day}`);
  return d;
}

export function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Same day-of-month N months later, clamped to month end (Jan 31 + 1 → Feb 28/29). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}
