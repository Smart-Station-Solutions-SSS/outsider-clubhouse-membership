import nodemailer from 'nodemailer';
import { config } from '../config';

// Without SMTP_HOST, emails are logged instead of sent (local development).

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

export async function sendMail(to: string | null | undefined, subject: string, text: string): Promise<void> {
  if (!to) return;
  if (!transport) {
    if (config.NODE_ENV !== 'test') console.log(`[mail] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
  } catch (err) {
    // A mail failure must never undo an approval or a payment.
    console.error('[mail] send failed:', err instanceof Error ? err.message : err);
  }
}

export const webLink = (path: string) => `${config.WEB_PUBLIC_URL.replace(/\/+$/, '')}${path}`;
