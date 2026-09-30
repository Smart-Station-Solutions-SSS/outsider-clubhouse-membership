import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { config } from '../config';
import { badRequest, notFound } from './errors';
import { randomToken } from './pii';

// National ID photos live on local disk outside any static route; only the admin API
// streams them back.

export const uploadRoot = path.resolve(config.UPLOAD_DIR);
fs.mkdirSync(path.join(uploadRoot, 'ids'), { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const idPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(badRequest('bad_image_type', 'Upload a JPG, PNG or WEBP photo of the ID card'));
  },
});

export function saveIdPhoto(buffer: Buffer, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const rel = path.posix.join('ids', `${randomToken(18)}.${ext}`);
  fs.writeFileSync(path.join(uploadRoot, rel), buffer);
  return rel;
}

export function resolveUpload(rel: string | null | undefined): string {
  if (!rel) throw notFound('No ID photo on file');
  const full = path.resolve(uploadRoot, rel);
  if (!full.startsWith(uploadRoot + path.sep) || !fs.existsSync(full)) throw notFound('No ID photo on file');
  return full;
}
