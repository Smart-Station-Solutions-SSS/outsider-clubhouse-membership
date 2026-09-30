# Outsider Clubhouse API: the SSS integration

This document is for SSS-Community-App developers. It covers what the SSS backend calls, server to server.
Base URL: `https://<outsider-host>/api`. Locally that is `http://localhost:4100/api`.

## Authentication

Every SSS call sends `x-api-key: ocm_XXXXXXXX_…`. Never send the key from a browser or the mobile app.
Create a key with `cd server && npm run apikey:create -- <ADMIN|PARTNER> "<name>"`. The key is printed once; only its hash is stored.

| Key kind | Used by | Route prefix |
|---|---|---|
| `ADMIN` | SSS admin dashboard, through the SSS backend | `/api/admin/*` |
| `PARTNER` | SSS community app, through the SSS backend | `/api/partner/*` |

A missing or invalid key returns 401. The wrong kind of key returns 403 `wrong_key_kind`.

Optional header `x-actor: <admin name or id>`. It is recorded as `reviewedBy` when an application or request is approved or rejected.

Errors always have this shape: `{ "error": { "code": "snake_case", "message": "human readable", "details"?: … } }`.
The status codes are 400, 401, 403, 404, 409 and 500.

## Admin API (`ADMIN` key)

### Settings: the approval toggles

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/admin/clubs` | – | `{ clubs: Settings[] }` |
| POST | `/admin/clubs` | `{ name, sssCommunityId?, currency? }` | `{ club: Settings }` |
| GET | `/admin/clubs/:clubId/settings` | – | `{ settings: Settings }` |
| PATCH | `/admin/clubs/:clubId/settings` | any subset of `Settings` except id and currency | `{ settings: Settings }` |
| GET | `/admin/clubs/:clubId/summary` | – | `{ pendingMembers, pendingDayUse, pendingGuests, activeMemberships }` |

```ts
type Settings = {
  id: string; name: string;
  sssCommunityId: string | null;   // links the club to an SSS community (the partner API looks it up by this)
  isActive: boolean; currency: 'EGP';
  membershipApproval: 'AUTO' | 'ADMIN';  // AUTO: an OCR-verified ID is approved at once; a failed ID still goes to review
  dayUseApproval: 'AUTO' | 'ADMIN';      // day-use requests and guest invitations
  guestDiscountPercent: number;          // 0–100, taken off the day-use price for guests
  outsiderGuestsPerDay: number;          // 0–20; SSS plans carry no outsider guest allowance, so this is used
  sssFacilityId: string | null;          // SSS facility whose plans / OUTSIDER fees are sold (null = auto-pick)
  catalogManagedBySss: boolean;          // read-only: prices come from SSS (see "Catalog sync")
  catalogSyncedAt: string | null;        // read-only: last successful sync
  catalogSyncError: string | null;       // read-only: last sync failure
};
```

### Catalog sync: plans and prices come from SSS

When SSS sync is configured and the club has an `sssCommunityId`, the club is **managed by SSS**. Its age bands, plans, prices and day-use fees are copied from the SSS Clubhouse settings:

- **Age bands** come from `MembershipAgeBand` (active bands only).
- **Plans and their prices** come from `ClubhouseMembershipPlan`, using its **OUTSIDE** price column. A plan is sold only when it is active, has at least one OUTSIDE price, and its facility is the club's facility (or no facility).
- **Day-use fees** come from `ClubhouseEntryFee` rows in the **OUTSIDER** fee group, for the club's facility.

The club's facility is `sssFacilityId` if it is set. Otherwise it is the single facility that has OUTSIDER entry fees.

The copy is refreshed every 5 minutes, and immediately when a club is linked or its facility changes. It can also be refreshed on demand with `POST /admin/clubs/:clubId/sync-catalog`, which returns `{ sync: { facilityId, ageBands, plansOnSale, plansHidden, dayUseFees, syncedAt } }`.

While a managed club has never synced successfully, it sells nothing. The price endpoints below return **409 `catalog_managed_by_sss`** for a managed club.

**SSS must serve** `GET {SSS_API_URL}/v1/outsider-club/catalog?communityId=`, protected by the `x-outsider-sync-key` header (the same value as `SSS_SYNC_KEY`):

```ts
{
  communityId: string; currency: string;
  ageBands: { id; name; minAgeYears; maxAgeYears: number | null }[];
  facilities: { id; name }[];
  plans: { id; name; description: string | null; termMonths; facilityId: string | null; isActive;
           outsidePrices: { ageBandId; price: number | string }[] }[];
  outsiderEntryFees: { facilityId; ageBandId; price: number | string }[];
}
```

### Prices (only for clubs not managed by SSS)

A price of `null`, or a band with no price, means **not sold** to that age band. It never means free.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/admin/clubs/:clubId` | – | Full catalog: settings, `ageBands`, `plans` (including archived ones) with `prices`, and `dayUseFees` |
| PUT | `/admin/clubs/:clubId/age-bands` | `{ bands: [{ id?, label, minAge, maxAge \| null }] }` | Bands must cover every age from 0 with no gaps; only the last band is open-ended. Pass `id` to keep an existing band. A band that has already been sold cannot be removed. |
| POST | `/admin/clubs/:clubId/plans` | `{ name, description?, termMonths, guestsPerDay, isActive?, prices: [{ ageBandId, price \| null }] }` | |
| PATCH | `/admin/clubs/:clubId/plans/:planId` | any subset of the above | Sending `prices` replaces the whole price list |
| DELETE | `/admin/clubs/:clubId/plans/:planId` | – | A plan that has been sold is archived instead: `{ archived: true }` |
| PUT | `/admin/clubs/:clubId/day-use-fees` | `{ fees: [{ ageBandId, price \| null }] }` | |

### Membership applications

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/clubs/:clubId/members?status=PENDING_REVIEW&search=&page=1&pageSize=25` | `{ total, page, pageSize, members: AdminMember[] }` |
| GET | `/admin/members/:id` | `{ member, memberships[] }` |
| GET | `/admin/members/:id/id-photo` | Image stream of the uploaded ID card |
| POST | `/admin/members/:id/approve` | `{ note? }`. Emails the applicant |
| POST | `/admin/members/:id/reject` | `{ note? }`. The note is shown to the applicant |

`AdminMember` has these fields:
- `id`, `fullName`, `email`, `phone`
- `nationalId` (full number) and `nationalIdMasked`
- `dateOfBirth` (read from the national ID)
- `ocrStatus: 'MATCHED' | 'MISMATCH_FLAGGED'`: flagged means the OCR could not read the card, so the applicant typed the number: check it against the photo
- `status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'`
- `reviewNote`, `reviewedAt`, `reviewedBy`, `hasIdPhoto`, `createdAt`

### Day-use and guest requests

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/clubs/:clubId/visit-requests?status=&kind=DAY_USE\|GUEST&visitDate=YYYY-MM-DD&page=` | `{ total, requests: VisitRequest[] }` |
| GET | `/admin/visit-requests/:id` | `{ request }` |
| GET | `/admin/visit-requests/:id/id-photo` | The buyer's ID photo (day use only) |
| POST | `/admin/visit-requests/:id/approve` | `{ note? }`. The payer is emailed to pay |
| POST | `/admin/visit-requests/:id/reject` | `{ note? }` |

`VisitRequest` has these fields:
- `id`, `kind`, `visitDate`, `contactName`, `contactEmail`, `contactPhone`, `total`, `ocrStatus`
- `status`: `PENDING_REVIEW` → `APPROVED` → `PAID`; or `REJECTED` / `CANCELLED`
- `host`: `{kind:'MEMBER',memberId}`, `{kind:'SSS_RESIDENT',residentId,name}`, or `null` for day use
- `passes[]`, one per person: `fullName`, `nationalId`, `dateOfBirth`, `price`, `status`, and `qrToken` once paid

### Memberships, payments, check-in

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/clubs/:clubId/memberships?status=ACTIVE` | Cards, each with its `member` |
| GET | `/admin/clubs/:clubId/payments?status=COMPLETED` | Paymob payments |
| POST | `/admin/memberships/:id/mark-paid` | `{ clubId?, reference?, note? }`. The desk took the money: records a COMPLETED `MANUAL` payment for the full price and activates the card (emails the member). 409 `not_payable` unless PENDING_PAYMENT; 404 if `clubId` is given and the card is another club's |
| POST | `/admin/check-in` | `{ qrToken, clubId? }`. Marks a pass USED. Returns 409 `already_used`, `wrong_day` or `not_active` |

## Partner API (`PARTNER` key): resident guests from the community app

SSS confirms that the resident holds an active clubhouse membership, and sends that plan's daily guest limit as `guestLimitPerDay`.
The guest price is the day-use price for the guest's age, minus `guestDiscountPercent`.
Approval follows `dayUseApproval`.
The club is found by `sssCommunityId`, which is set with PATCH settings.

| Method | Path | Body / query |
|---|---|---|
| GET | `/partner/communities/:communityId/guest-policy` | Returns `{ clubId, clubName, currency, approval, guestDiscountPercent, ageBands, dayUseFees }` |
| POST | `/partner/communities/:communityId/guest-quote` | `{ visitDate, guests: [{ fullName, nationalId }] }` returns `{ guests:[{price}], total }` |
| POST | `/partner/communities/:communityId/guest-requests` | `{ host: { residentId, name, phone, email?, guestLimitPerDay }, visitDate, guests: [{ fullName, nationalId, phone? }] }` returns `{ request }` |
| GET | `/partner/communities/:communityId/residents/:residentId/guest-requests` | Returns `{ requests }` |
| GET | `/partner/guest-requests/:id?residentId=` | Returns `{ request }`. `residentId` must be the host's, otherwise 404 |
| POST | `/partner/guest-requests/:id/pay?residentId=` | Returns `{ paymentId, checkoutUrl }`. Open `checkoutUrl` in the app's webview |
| POST | `/partner/guest-requests/:id/cancel?residentId=` | Works only while the request is unpaid |

When the request status is `PAID`, each pass has a `qrToken` for the guest to show at the gate.
`visitDate` can be at most 60 days ahead.
Common error codes:
- `guest_limit`: over the resident's daily guest limit
- `not_sold`: no day-use price for that guest's age
- `already_booked`: that person already has a pass for the day
- `invalid_national_id`
