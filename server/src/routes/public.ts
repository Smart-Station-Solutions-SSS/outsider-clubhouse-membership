import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../db';
import { idPhotoUpload } from '../lib/uploads';
import { loadActiveClub, publicCatalog } from '../services/catalog';
import { runIdCheck, runManualIdCheck } from '../services/id-checks';
import { paymentsAvailable } from '../services/payments';
import {
  cancelVisitRequest,
  findByAccessToken,
  payVisitRequest,
  visitRequestDto,
} from '../services/visits';
import { nationalId } from './schemas';

export const publicRouter = Router();

// The test suite runs every flow from one address.
const idCheckLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => config.NODE_ENV === 'test' });
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true, payments: paymentsAvailable() });
});

publicRouter.get('/clubs', async (_req, res) => {
  const clubs = await prisma.club.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
  res.json({ clubs });
});

publicRouter.get('/clubs/:clubId/catalog', async (req, res) => {
  res.json(publicCatalog(await loadActiveClub(req.params.clubId)));
});

/**
 * Upload a card photo: OCR reads the national ID number (and so the birth date) off it.
 * Retries send the same checkId; after 3 unreadable photos the number may be typed instead.
 * When an admin approves that flow (membership in ADMIN mode, or a member's guest), no OCR runs: the number
 * is typed alongside the photo.
 */
publicRouter.post('/id-check', idCheckLimiter, idPhotoUpload.single('photo'), async (req, res) => {
  const body = z
    .object({
      clubId: z.string().uuid().optional(),
      purpose: z.enum(['membership', 'day-use', 'guest']).optional(),
      checkId: z.string().uuid().optional(),
      nationalId: nationalId.optional(),
    })
    .parse(req.body);
  const image = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : undefined;
  if (body.clubId && body.purpose) {
    const club = await loadActiveClub(body.clubId);
    // Guests are always admin-approved, so their photo is never OCR'd.
    const mode = body.purpose === 'membership' ? club.membershipApproval : body.purpose === 'day-use' ? club.dayUseApproval : 'ADMIN';
    if (mode === 'ADMIN') return void res.json(await runManualIdCheck({ image, typedNationalId: body.nationalId }));
  }
  res.json(await runIdCheck({ checkId: body.checkId, typedNationalId: body.nationalId, image }));
});

// Day passes are booked from a logged-in account (see routes/account.ts). Requests made before
// that keep working through their private link below.

const token = (q: unknown) => z.object({ t: z.string().min(10) }).parse(q).t;

publicRouter.get('/visits/:id', async (req, res) => {
  const r = await findByAccessToken(req.params.id, token(req.query));
  res.json({ request: visitRequestDto(r), club: { id: r.club.id, name: r.club.name, currency: r.club.currency } });
});

publicRouter.post('/visits/:id/pay', writeLimiter, async (req, res) => {
  const r = await findByAccessToken(String(req.params.id), token(req.query));
  res.json(await payVisitRequest(r, r.club));
});

publicRouter.post('/visits/:id/cancel', async (req, res) => {
  const r = await findByAccessToken(req.params.id, token(req.query));
  await cancelVisitRequest(r.id);
  res.json({ ok: true });
});
