// Thin fetch wrapper for the clubhouse API (same origin via the Vite proxy / nginx).

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? 'Something went wrong', err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
};

// ── Types mirrored from the server DTOs ──

export type ApprovalMode = 'AUTO' | 'ADMIN';

export type AgeBand = { id: string; label: string; minAge: number; maxAge: number | null };

export type Catalog = {
  id: string;
  name: string;
  currency: string;
  membershipApproval: ApprovalMode;
  dayUseApproval: ApprovalMode;
  guestDiscountPercent: number;
  ageBands: AgeBand[];
  plans: {
    id: string;
    name: string;
    description: string | null;
    termMonths: number;
    guestsPerDay: number;
    prices: { ageBandId: string; price: number }[];
  }[];
  dayUseFees: { ageBandId: string; price: number }[];
  /** Member guest prices from the SSS dashboard; empty = dayUseFees minus guestDiscountPercent. */
  guestFees: { ageBandId: string; price: number }[];
};

export type IdCheck = {
  checkId: string;
  outcome: 'MATCHED' | 'MISMATCH' | 'UNREADABLE' | 'UNAVAILABLE' | 'MANUAL';
  attemptsLeft: number;
  canSubmit: boolean;
  /** Out of OCR tries: the number must be typed (staff review the photo). */
  manualEntry: boolean;
  /** Read off the card photo (or typed after the last failed try). */
  nationalId: string | null;
  dateOfBirth: string | null;
};

export type Member = {
  id: string;
  clubId: string;
  email: string;
  /** The membership application: all null while status is ACCOUNT (email + password only). */
  fullName: string | null;
  phone: string | null;
  nationalIdMasked: string | null;
  dateOfBirth: string | null;
  ocrStatus: 'MATCHED' | 'MISMATCH_FLAGGED' | null;
  status: 'ACCOUNT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
};

export type PlanQuote = {
  planId: string;
  name: string;
  description: string | null;
  termMonths: number;
  guestsPerDay: number;
  ageBandLabel: string | null;
  price: number | null;
};

export type Membership = {
  id: string;
  planId: string;
  planName: string | null;
  termMonths: number | null;
  guestsPerDay: number | null;
  price: number;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startsAt: string | null;
  endsAt: string | null;
  cardNumber: string | null;
};

export type Pass = {
  id: string;
  kind: 'DAY_USE' | 'GUEST';
  visitDate: string;
  fullName: string;
  nationalIdMasked: string;
  price: number;
  status: 'PENDING_REVIEW' | 'PENDING_PAYMENT' | 'ACTIVE' | 'USED' | 'EXPIRED' | 'REJECTED' | 'CANCELLED';
  qrToken: string | null;
};

export type VisitRequest = {
  id: string;
  kind: 'DAY_USE' | 'GUEST';
  status: 'PENDING_REVIEW' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
  visitDate: string;
  contactName: string;
  total: number;
  reviewNote: string | null;
  passes: Pass[];
};

export type Checkout = { paymentId: string; checkoutUrl: string };

/** photo: the guest's ID card (or birth certificate) photo, for members' guest invites. */
export type PersonDraft = { fullName: string; nationalId: string; phone?: string; photo?: File | null };
