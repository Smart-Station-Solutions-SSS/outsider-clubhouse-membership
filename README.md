# Outsider Clubhouse Membership

This is the public website for people who don't live in the community (outsiders) and want to use the clubhouse. It is separate from SSS-Community-App and has its own database.

- **Membership:** the applicant signs up and uploads a photo of their national ID card. OCR reads the national ID number off the card, and the birth date is read from that number. Plans are then priced for the applicant's age. Approval is either automatic or done by an admin. The member then pays with Paymob.
- **Day pass:** someone who isn't a member pays for a single day. Approval is automatic or done by an admin, and each person gets a QR code.
- **Guests:** members invite guests at the day-pass price minus a discount. This works on this site, and for SSS residents through the partner API.
- **Admin:** there are no admin screens in this project. The SSS admin dashboard manages settings, prices and approvals through `/api/admin/*`, using an API key. See [docs/API.md](docs/API.md).

```
server/   Node 20 · Express 5 · TypeScript · Prisma 5 · PostgreSQL
web/      React 19 · Vite 6 · Tailwind 4 · TanStack Query
```

## Run locally

Prerequisites: Node 20 and PostgreSQL on `localhost:5432`, with user `postgres` and password `123456`.

```bash
cd server
cp .env.example .env        # then fill in the secrets (see below)
npm install
npx prisma migrate dev      # creates the database "outsider-clubhouse-membership"
npm run db:seed             # sample club, age bands, plans and prices
npm run apikey:create -- ADMIN "SSS dashboard"
npm run dev                 # http://localhost:4100/api

cd ../web
npm install
npm run dev                 # http://localhost:5174 (/api is proxied to :4100)
```

Tests: `cd server && npm test`. They use a separate `outsider-clubhouse-membership-test` database, which is reset on every run.

## Configuration (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `TEST_DATABASE_URL` | Postgres connections |
| `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `PII_HASH_KEY` | Random values of at least 32 characters. **Never change `PII_*` after launch**: stored national IDs can then no longer be decrypted |
| `GATES_OCR_URL`, `GATES_OCR_API_KEY` | ID-card OCR. The gates server only accepts listed IP addresses, so add the production server's IP to its allowlist. Without that, every ID goes to admin review, flagged. Check the connection with `npm run ocr:check -- <card-photo.jpg>` |
| `PAYMOB_*` | Same meaning as in SSS-Community-App. `PAYMOB_CARD_INTEGRATION_ID` must be set, and so must `PAYMOB_HMAC_SECRET` or `PAYMOB_API_KEY` |
| `API_PUBLIC_BASE_URL` | Public URL of this API. Paymob calls `…/api/payments/paymob/webhook` and returns the buyer to `…/api/payments/paymob/return` |
| `WEB_PUBLIC_URL` | Public URL of the website, used in email links and after payment |
| `SSS_API_URL`, `SSS_SYNC_KEY` | SSS backend and the shared key for its outsider catalog endpoint. Plans, age bands and prices are **pulled from the SSS dashboard** (Clubhouse) every 5 minutes for linked clubs. See docs/API.md, "Catalog sync" |
| `PAYMOB_MOCK` | `true` replaces Paymob with a fake checkout page. **Ignored when `NODE_ENV=production`** |
| `SMTP_*`, `MAIL_FROM` | Outgoing email. If `SMTP_HOST` is empty, emails are printed to the console instead |
| `PAYMENT_HOLD_MINUTES` | How long an unpaid membership order is kept before it is cancelled (default: one day) |

## Production

1. Run `npm run build` in both `server/` and `web/`. Run `npm run db:deploy` in `server/`, then start it with `npm start`.
2. Serve `web/dist` as a single-page app, with every path falling back to `index.html`. Proxy `/api/` on the same domain to the server, so the session cookie stays first-party.
3. Set `NODE_ENV=production`, the real `API_PUBLIC_BASE_URL` and `WEB_PUBLIC_URL`, the Paymob keys and SMTP.
4. Create API keys for SSS: one `ADMIN` key for the dashboard and one `PARTNER` key for the community app. Put them in SSS's `.env`.
5. Link the club to its SSS community: `PATCH /api/admin/clubs/:id/settings { "sssCommunityId": "<SSS community id>" }`.

## Business rules

- Prices are set per plan × age band. A blank price means **not sold** to that age band, never free.
- The age used for a membership is the age on the day it is bought. For a day pass or guest pass it is the age on the visit day.
- In AUTO mode, only an ID that the OCR actually confirmed is approved automatically. After 3 unreadable photos (or at once, if the OCR server is unreachable) the person can type the number instead and submit, and the application goes to admin review, flagged. In ADMIN mode no OCR runs at all: the person types the number and uploads the photo, and the admin compares the two.
- A renewal starts the day after the current membership ends.
- Guest limit: the plan's `guestsPerDay`, counted per host per visit day, including requests that are still unpaid.
- A background job runs every 15 minutes. It expires memberships and passes, and cancels unpaid orders that are past their hold time or whose visit day has passed.
