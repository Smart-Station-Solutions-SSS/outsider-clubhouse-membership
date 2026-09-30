import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Please log in') => new HttpError(401, 'unauthorized', message);
export const forbidden = (code: string, message: string) => new HttpError(403, code, message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: err.issues[0]?.message ?? 'Invalid input',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err?.name === 'MulterError') {
    res.status(400).json({ error: { code: 'upload_rejected', message: err.message } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
    return;
  }
  if (err?.code === 'P2034') {
    // Serializable transaction lost a race (e.g. two guest invites for the same host at once).
    res.status(409).json({ error: { code: 'busy', message: 'Please try again' } });
    return;
  }
  if (err?.code === 'P2023' || err?.code === 'P2025') {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
