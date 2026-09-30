# Outsider Clubhouse Membership: design

Date: 2026-09-30. Approved in chat by the owner.

## Decisions

- **A standalone system.** This project has its own Express backend and its own Postgres database, `outsider-clubhouse-membership`.
  - The outsider portal inside SSS-Community-App (`/club`, `/v1/outsider/*`) is being removed by the SSS team.
  - SSS reaches this project only through its API, server to server, with `x-api-key`.
- **Settings live in this project's database.** These are `membershipApproval`, `dayUseApproval` and `guestDiscountPercent`. The SSS admin dashboard shows the toggles and saves them through `/api/admin/*`.
- **Two groups can invite guests.**
  - Outsider members, on this site.
  - SSS resident members, through `/api/partner/*`. SSS confirms the resident's membership and sends their daily guest limit.
- **Guest price** = the day-use price for the guest's age × (100 − discount%).
- **OCR.** The gates OCR server must read the same national ID number the applicant typed, and the applicant gets 3 tries.
  - In AUTO mode, only a matched ID is approved automatically.
  - After 3 failed tries the person may still submit, and it goes to admin review, flagged.
- **Birth date** always comes from the national ID number, and prices use it.
- **Ported from SSS:** the Paymob client (unified checkout and legacy iframe, HMAC check, read-back when there is no HMAC secret), the gates OCR wire format, and the national ID reader.

## Model

| Table | What it holds |
|---|---|
| Club | The clubhouse and its approval settings |
| AgeBand | Age ranges used for pricing |
| Plan, PlanPrice | Membership plans and their price per age band |
| DayUseFee | Day-pass price per age band |
| Member | The outsider account: national ID (encrypted, plus a keyed hash for lookups), birth date, ID photo, OCR result, review status |
| Membership | One purchased membership, with the age band and price as they were at purchase |
| VisitRequest | A day-use purchase or a guest invitation, with its host and approval status |
| Pass | One person on one visit day; gets a QR code once paid |
| Payment, WebhookLedger | Paymob payments, and the record that stops a callback being processed twice |
| ApiKey | SSS API keys, stored hashed; kind ADMIN or PARTNER |
| IdCheck | Server-side count of OCR attempts |

## Out of scope

- Admin screens inside this project. They are built in SSS.
- Family memberships.
- Refunds.
- Arabic or right-to-left layout.
