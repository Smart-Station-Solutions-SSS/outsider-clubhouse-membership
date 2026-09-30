import { config } from '../config';
import { HttpError } from './errors';

// Read-only client for the SSS-Community-App outsider catalog:
//   GET ${SSS_API_URL}/v1/outsider-club/catalog?communityId=<id>
//   header x-outsider-sync-key: ${SSS_SYNC_KEY}
// SSS is the source of truth for plans, age bands, OUTSIDE plan prices and OUTSIDER entry fees.

export type SssCatalog = {
  communityId: string;
  currency?: string;
  ageBands: { id: string; name: string; minAgeYears: number; maxAgeYears: number | null }[];
  facilities: { id: string; name: string }[];
  plans: {
    id: string;
    name: string;
    description: string | null;
    termMonths: number;
    facilityId: string | null;
    isActive: boolean;
    /** Guests a day an outsider member on this plan may invite (set in the SSS dashboard). Absent on older SSS builds. */
    outsiderGuestLimit?: number | null;
    /** Cells of the OUTSIDE price column; a missing band = not sold to that band. */
    outsidePrices: { ageBandId: string; price: number | string }[];
  }[];
  /** ClubhouseEntryFee rows with feeGroup OUTSIDER. */
  outsiderEntryFees: { facilityId: string; ageBandId: string; price: number | string }[];
  /** ClubhouseEntryFee rows with feeGroup GUEST: what a member's guest pays. Absent on older SSS builds. */
  guestEntryFees?: { facilityId: string; ageBandId: string; price: number | string }[];
};

export const sssSyncConfigured = () => Boolean(config.SSS_API_URL.trim() && config.SSS_SYNC_KEY.trim());

async function fetchCatalogHttp(communityId: string): Promise<SssCatalog> {
  const base = config.SSS_API_URL.trim().replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/v1/outsider-club/catalog?communityId=${encodeURIComponent(communityId)}`, {
      headers: { 'x-outsider-sync-key': config.SSS_SYNC_KEY.trim(), accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(502, 'sss_unreachable', 'SSS could not be reached to load plans and prices');
  }
  if (!res.ok) throw new HttpError(502, 'sss_error', `SSS answered ${res.status} when loading plans and prices`);
  const body = (await res.json().catch(() => null)) as SssCatalog | null;
  if (!body || !Array.isArray(body.ageBands) || !Array.isArray(body.plans) || !Array.isArray(body.outsiderEntryFees)) {
    throw new HttpError(502, 'sss_bad_response', 'SSS returned an unexpected catalog');
  }
  body.facilities ??= [];
  return body;
}

/** Swappable for tests. */
export const sss = { fetchCatalog: fetchCatalogHttp };
