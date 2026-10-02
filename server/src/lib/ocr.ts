import { config } from '../config';
import { normalizeNationalId } from './national-id';
import type { OcrRead } from './id-check';

// Client for the gates OCR server (same wire contract as SSS gates-ocr.client.ts):
//   POST ${GATES_OCR_URL}/ocr/extract   x-api-key: ${GATES_OCR_API_KEY}
//   body { image_base64: "data:<mime>;base64,<b64>" }
//   200  { status: 'ok', national_id, full_name, ... }   422 = no card in the photo
// One attempt, never throws; the key is never logged.

export type OcrResult = OcrRead & { fullName?: string | null };

export interface IdOcrReader {
  read(image: Buffer, mimeType: string): Promise<OcrResult>;
}

export const gatesOcrReader: IdOcrReader = {
  async read(image, mimeType) {
    const baseUrl = config.GATES_OCR_URL.trim().replace(/\/+$/, '');
    const apiKey = config.GATES_OCR_API_KEY.trim();
    if (!baseUrl || !apiKey) return { kind: 'unavailable' };

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/ocr/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ image_base64: `data:${mimeType};base64,${image.toString('base64')}` }),
        signal: AbortSignal.timeout(Math.min(Math.max(config.GATES_OCR_TIMEOUT_MS, 1000), 120000)),
      });
    } catch (err) {
      console.warn('[ocr] request failed:', err instanceof Error ? err.name : 'error');
      return { kind: 'unavailable' };
    }
    if (response.status === 422) return { kind: 'unreadable' };
    if (!response.ok) {
      // A bare nginx 403 means the gates host's IP allowlist rejected this server, whatever the key.
      console.warn(`[ocr] http ${response.status}${response.status === 403 ? ' (is this server IP-allowlisted on the gates host?)' : ''}`);
      return { kind: 'unavailable' };
    }
    const body = (await response.json().catch(() => null)) as
      | { status?: unknown; national_id?: unknown; full_name?: unknown }
      | null;
    if (!body || body.status !== 'ok') return { kind: 'unavailable' };
    const nationalId = normalizeNationalId(body.national_id);
    if (nationalId.length !== 14) return { kind: 'unreadable' };
    return {
      kind: 'ok',
      nationalId,
      fullName: typeof body.full_name === 'string' ? body.full_name.trim() || null : null,
    };
  },
};

/** Swappable for tests. */
export const ocr = { reader: gatesOcrReader as IdOcrReader };
