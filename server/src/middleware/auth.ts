import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ApiKeyKind, Member } from '@prisma/client';
import { config, isProduction } from '../config';
import { prisma } from '../db';
import { unauthorized, HttpError } from '../lib/errors';
import { safeEqual, sha256 } from '../lib/pii';

// Members: a JWT in an httpOnly cookie. SSS (admin dashboard / community app): an API key.

export const SESSION_COOKIE = 'ocm_session';
const SESSION_DAYS = 7;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      member?: Member;
      apiKey?: { id: string; name: string; kind: ApiKeyKind };
    }
  }
}

export function setSession(res: Response, member: Member) {
  const token = jwt.sign({ sub: member.id, sv: member.sessionVersion }, config.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function requireMember(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(unauthorized());
  let payload: { sub?: string; sv?: number };
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as typeof payload;
  } catch {
    return next(unauthorized('Your session expired. Please log in again.'));
  }
  const member = payload.sub ? await prisma.member.findUnique({ where: { id: payload.sub } }) : null;
  if (!member || member.sessionVersion !== payload.sv) return next(unauthorized('Your session expired. Please log in again.'));
  req.member = member;
  next();
}

/** Key format: ocm_<8-char prefix>_<secret>. Only sha256 of the whole key is stored. */
export function requireApiKey(kind: ApiKeyKind) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const key = String(req.header('x-api-key') ?? '').trim();
    const m = /^ocm_([A-Za-z0-9]{8})_[A-Za-z0-9_-]{20,}$/.exec(key);
    if (!m) return next(new HttpError(401, 'invalid_api_key', 'Missing or invalid x-api-key'));
    const row = await prisma.apiKey.findUnique({ where: { prefix: m[1] } });
    if (!row || row.revokedAt || !safeEqual(row.hash, sha256(key))) {
      return next(new HttpError(401, 'invalid_api_key', 'Missing or invalid x-api-key'));
    }
    if (row.kind !== kind) return next(new HttpError(403, 'wrong_key_kind', `This endpoint needs a ${kind} key`));
    req.apiKey = { id: row.id, name: row.name, kind: row.kind };
    prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    next();
  };
}

/** Who made an admin decision: the SSS admin's name/id if forwarded, else the key name. */
export function actorOf(req: Request): string {
  const forwarded = String(req.header('x-actor') ?? '').trim().slice(0, 120);
  return forwarded ? `${req.apiKey?.name ?? 'api'}:${forwarded}` : (req.apiKey?.name ?? 'api');
}
