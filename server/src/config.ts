import 'dotenv/config';
import { z } from 'zod';

const flag = z
  .string()
  .optional()
  .transform((v) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  WEB_PUBLIC_URL: z.string().default('http://localhost:5174'),
  API_PUBLIC_BASE_URL: z.string().default('http://localhost:4100'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PII_ENCRYPTION_KEY: z.string().min(32),
  PII_HASH_KEY: z.string().min(32),
  GATES_OCR_URL: z.string().default(''),
  GATES_OCR_API_KEY: z.string().default(''),
  GATES_OCR_TIMEOUT_MS: z.coerce.number().default(15000),
  PAYMOB_ENABLED: flag,
  PAYMOB_FLOW_TYPE: z.enum(['UNIFIED_CHECKOUT', 'LEGACY_IFRAME']).default('UNIFIED_CHECKOUT'),
  PAYMOB_API_KEY: z.string().default(''),
  PAYMOB_SECRET_KEY: z.string().default(''),
  PAYMOB_PUBLIC_KEY: z.string().default(''),
  PAYMOB_IFRAME_ID: z.string().default(''),
  PAYMOB_CARD_INTEGRATION_ID: z.string().default(''),
  PAYMOB_HMAC_SECRET: z.string().default(''),
  PAYMOB_MOCK: flag,
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('Clubhouse <no-reply@clubhouse.local>'),
  /// SSS-Community-App backend (e.g. http://localhost:4003). Plans & prices are pulled from it.
  SSS_API_URL: z.string().default(''),
  /// Shared key SSS checks on its outsider-catalog endpoint (x-outsider-sync-key).
  SSS_SYNC_KEY: z.string().default(''),
  UPLOAD_DIR: z.string().default('./uploads'),
  /// Minutes an unpaid approved order stays payable before it is released.
  PAYMENT_HOLD_MINUTES: z.coerce.number().default(60 * 24),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
/** The fake checkout is never available in production, whatever the flag says. */
export const paymobMockEnabled = config.PAYMOB_MOCK && !isProduction;
