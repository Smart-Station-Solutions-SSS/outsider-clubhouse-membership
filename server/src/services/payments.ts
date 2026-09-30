import type { Payment, Prisma } from '@prisma/client';
import { config, paymobMockEnabled } from '../config';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { sendMail, webLink } from '../lib/mailer';
import {
  buildBillingData,
  extractTransaction,
  inferOutcome,
  paymob,
  paymobConfigured,
  verifyHmac,
  type PaymentOutcome,
} from '../lib/paymob';
import { toCents } from '../lib/pricing';
import { activateMembership, activateVisitRequest } from './fulfilment';
import { visitLink } from './visits';

const SESSION_TTL_MS = 50 * 60 * 1000; // Paymob payment keys live 60 minutes.

type Target = { membershipId: string } | { visitRequestId: string };

export async function openCheckout(input: {
  clubId: string;
  target: Target;
  amountCents: number;
  currency: string;
  payer: { name: string; email?: string | null; phone?: string | null };
}): Promise<{ paymentId: string; checkoutUrl: string }> {
  if (input.amountCents <= 0) throw badRequest('nothing_to_pay', 'There is nothing to pay');

  // Reuse an open session for the same order and amount instead of opening a second one.
  const open = await prisma.payment.findFirst({
    where: { ...input.target, status: 'PENDING', amountCents: input.amountCents, expiresAt: { gt: new Date() }, checkoutUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (open?.checkoutUrl) return { paymentId: open.id, checkoutUrl: open.checkoutUrl };

  const payment = await prisma.payment.create({
    data: {
      clubId: input.clubId,
      ...input.target,
      amountCents: input.amountCents,
      currency: input.currency,
      provider: paymobMockEnabled ? 'MOCK' : 'PAYMOB',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  if (paymobMockEnabled) {
    const checkoutUrl = webLink(`/mock-pay/${payment.id}`);
    await prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl } });
    return { paymentId: payment.id, checkoutUrl };
  }

  try {
    const session = await paymob.createCheckout({
      paymentId: payment.id,
      amountCents: input.amountCents,
      currency: input.currency,
      billing: buildBillingData(input.payer),
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        checkoutUrl: session.checkoutUrl,
        providerOrderId: session.providerOrderId,
        rawRequest: session.rawRequest as Prisma.InputJsonValue,
      },
    });
    return { paymentId: payment.id, checkoutUrl: session.checkoutUrl };
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: err instanceof Error ? err.message.slice(0, 300) : 'checkout failed' },
    });
    throw err;
  }
}

/** Applies a gateway outcome exactly once and activates what was paid for. */
export async function applyOutcome(payment: Payment, outcome: PaymentOutcome, raw: unknown): Promise<void> {
  // A PENDING callback may be followed by the final one for the same transaction id,
  // so it must not enter the replay ledger.
  if (outcome.status === 'PENDING') return;
  await prisma.$transaction(async (tx) => {
    if (outcome.transactionId) {
      const seen = await tx.webhookLedger.findUnique({
        where: { provider_transactionId: { provider: payment.provider, transactionId: outcome.transactionId } },
      });
      if (seen) return;
      await tx.webhookLedger.create({ data: { provider: payment.provider, transactionId: outcome.transactionId } });
    }

    const moved = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        status: outcome.status,
        providerTransactionId: outcome.transactionId,
        providerOrderId: payment.providerOrderId ?? outcome.providerOrderId,
        failureReason: outcome.failureReason,
        paidAt: outcome.status === 'COMPLETED' ? (outcome.paidAt ?? new Date()) : null,
        rawCallback: (raw ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    if (moved.count !== 1 || outcome.status !== 'COMPLETED') return;

    const activated = payment.membershipId
      ? await activateMembership(tx, payment.membershipId)
      : payment.visitRequestId
        ? await activateVisitRequest(tx, payment.visitRequestId)
        : false;
    if (!activated) {
      // Money arrived for an order that was cancelled or already paid another way.
      console.error(`[REFUND_REQUIRED] payment ${payment.id} completed but its order could not be activated`);
    }
  });

  if (outcome.status === 'COMPLETED') await notifyPaid(payment.id);
}

async function notifyPaid(paymentId: string) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { membership: { include: { member: true, plan: true } }, visitRequest: true },
  });
  if (!p) return;
  if (p.membership) {
    await sendMail(
      p.membership.member.email,
      'Your membership is active',
      `Hi ${p.membership.member.fullName},\n\nPayment received — your ${p.membership.plan.name} membership is active.\n${webLink('/account')}`,
    );
  } else if (p.visitRequest) {
    await sendMail(
      p.visitRequest.contactEmail,
      'Your clubhouse passes are ready',
      `Hi ${p.visitRequest.contactName},\n\nPayment received. Your QR codes: ${visitLink(p.visitRequest)}\nShow them at the gate on your visit day.`,
    );
  }
}

/** Paymob "transaction processed" callback. */
export async function handlePaymobWebhook(query: Record<string, unknown>, body: unknown): Promise<{ ok: boolean; reason?: string }> {
  const tx = extractTransaction(body);
  if (!tx) return { ok: false, reason: 'no_transaction' };
  const outcome = inferOutcome(tx);

  const paymentId = typeof query.paymentId === 'string' ? query.paymentId : (outcome.merchantOrderId ?? undefined);
  let payment = paymentId ? await prisma.payment.findUnique({ where: { id: paymentId } }).catch(() => null) : null;
  if (!payment && outcome.providerOrderId) {
    payment = await prisma.payment.findFirst({ where: { providerOrderId: outcome.providerOrderId } });
  }
  if (!payment || payment.provider !== 'PAYMOB') return { ok: false, reason: 'unknown_payment' };

  let verified: PaymentOutcome | null = null;
  if (config.PAYMOB_HMAC_SECRET) {
    const hmac = typeof query.hmac === 'string' ? query.hmac : undefined;
    if (verifyHmac(tx, hmac, config.PAYMOB_HMAC_SECRET)) verified = outcome;
  } else if (outcome.transactionId) {
    verified = await readBack(payment, outcome.transactionId);
  }
  if (!verified) {
    console.warn(`[paymob] webhook for payment ${payment.id} failed verification`);
    return { ok: false, reason: 'verification_failed' };
  }
  await applyOutcome(payment, verified, body);
  return { ok: true };
}

/** No HMAC secret: trust only what Paymob itself reports for this transaction id, on our order, for our amount. */
async function readBack(payment: Payment, transactionId: string): Promise<PaymentOutcome | null> {
  const real = await paymob.fetchTransaction(transactionId);
  if (!real) return null;
  const o = inferOutcome(real);
  const sameOrder = (payment.providerOrderId && o.providerOrderId === payment.providerOrderId) || o.merchantOrderId === payment.id;
  return sameOrder && o.amountCents === String(payment.amountCents) ? o : null;
}

/**
 * The browser coming back from Paymob. The query string is not trusted; if it names a
 * transaction, it is read back from Paymob. This also completes payments when the webhook
 * cannot reach the server (local development).
 */
export async function reconcileOnReturn(paymentId: string, transactionId: string | undefined): Promise<void> {
  if (!transactionId || !config.PAYMOB_API_KEY) return;
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } }).catch(() => null);
  if (!payment || payment.provider !== "PAYMOB" || payment.status !== "PENDING") return;
  try {
    const verified = await readBack(payment, transactionId);
    if (verified) await applyOutcome(payment, verified, { source: "return", transactionId });
  } catch (err) {
    console.warn("[paymob] return reconciliation failed:", err instanceof Error ? err.message : err);
  }
}

/** Dev-only fake checkout (PAYMOB_MOCK=true, never in production). */
export async function completeMockPayment(paymentId: string, success: boolean) {
  if (!paymobMockEnabled) throw notFound();
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== 'MOCK') throw notFound('Payment not found');
  if (payment.status !== 'PENDING') throw conflict('payment_closed', 'This payment is already closed');
  await applyOutcome(
    payment,
    {
      status: success ? 'COMPLETED' : 'FAILED',
      transactionId: `mock-${payment.id}`,
      providerOrderId: null,
      merchantOrderId: payment.id,
      amountCents: String(payment.amountCents),
      failureReason: success ? null : 'Declined (mock)',
      paidAt: new Date(),
    },
    { mock: true, success },
  );
}

export async function paymentStatus(paymentId: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment not found');
  return {
    id: p.id,
    status: p.status,
    amount: p.amountCents / 100,
    currency: p.currency,
    kind: p.membershipId ? 'MEMBERSHIP' : 'VISIT',
    visitRequestId: p.visitRequestId,
    failureReason: p.failureReason,
  };
}

export const paymentsAvailable = () => paymobMockEnabled || paymobConfigured();

/**
 * The club's front desk took the money (cash, card machine, transfer), so an SSS admin
 * records it. Books a COMPLETED 'MANUAL' payment and activates the card in one transaction.
 * An open Paymob session is left alone: if it completes later, applyOutcome logs
 * REFUND_REQUIRED instead of the money disappearing silently.
 */
export async function recordManualMembershipPayment(
  membershipId: string,
  input: { clubId?: string; reference?: string; note?: string },
  actor: string,
) {
  const done = await prisma.$transaction(async (tx) => {
    const m = await tx.membership.findUnique({ where: { id: membershipId }, include: { member: { include: { club: true } } } });
    // clubId (sent by SSS) fences the call to that club's cards.
    if (!m || (input.clubId && m.member.clubId !== input.clubId)) throw notFound('Membership not found');
    if (m.status !== 'PENDING_PAYMENT') throw conflict('not_payable', 'This membership is not waiting for payment');
    const now = new Date();
    const payment = await tx.payment.create({
      data: {
        clubId: m.member.clubId,
        membershipId,
        amountCents: toCents(m.price),
        currency: m.member.club.currency,
        status: 'COMPLETED',
        provider: 'MANUAL',
        providerTransactionId: input.reference ?? null,
        paidAt: now,
        expiresAt: now,
        rawRequest: { recordedBy: actor, reference: input.reference ?? null, note: input.note ?? null },
      },
    });
    if (!(await activateMembership(tx, membershipId))) {
      throw conflict('not_payable', 'This membership is not waiting for payment');
    }
    return payment;
  });
  await notifyPaid(done.id);
  return prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { plan: true, member: true } });
}
