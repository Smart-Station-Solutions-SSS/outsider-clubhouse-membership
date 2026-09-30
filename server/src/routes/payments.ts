import { Router } from 'express';
import { z } from 'zod';
import { webLink } from '../lib/mailer';
import { completeMockPayment, handlePaymobWebhook, paymentStatus, reconcileOnReturn } from '../services/payments';

export const paymentsRouter = Router();

/** Paymob server-to-server callback. Always 200 so Paymob does not retry forever on a bad payload. */
paymentsRouter.post('/payments/paymob/webhook', async (req, res) => {
  try {
    const result = await handlePaymobWebhook(req.query as Record<string, unknown>, req.body);
    res.status(200).json(result);
  } catch (err) {
    console.error('[paymob] webhook error', err);
    res.status(200).json({ ok: false, reason: 'error' });
  }
});

/** The buyer's browser lands here after Paymob; send them to the web app's result page. */
paymentsRouter.get('/payments/paymob/return', async (req, res) => {
  const paymentId = typeof req.query.paymentId === 'string' ? req.query.paymentId : '';
  const transactionId = typeof req.query.id === 'string' ? req.query.id : undefined;
  if (paymentId) await reconcileOnReturn(paymentId, transactionId);
  res.redirect(webLink(`/payment/result?paymentId=${encodeURIComponent(paymentId)}`));
});

paymentsRouter.get('/payments/:id/status', async (req, res) => {
  res.json(await paymentStatus(req.params.id));
});

/** Dev-only: the fake checkout page posts here (404 unless PAYMOB_MOCK and not production). */
paymentsRouter.post('/payments/:id/mock', async (req, res) => {
  const body = z.object({ success: z.boolean() }).parse(req.body);
  await completeMockPayment(req.params.id, body.success);
  res.json(await paymentStatus(req.params.id));
});
